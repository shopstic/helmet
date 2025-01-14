import { inheritExec } from "@wok/utils/exec";
import { exists as fsExists, expandGlobSync } from "@std/fs";
import { dirname, join as joinPath, resolve as resolvePath } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import {
  format as semverFormat,
  maxSatisfying as maxSatisfyingSemver,
  parseRange as semverParseRange,
  type SemVer,
  tryParse as semverTryParse,
} from "@std/semver";
import { quoteShell } from "@wok/utils/quote-shell";
import { createCliAction, ExitCode } from "@wok/utils/cli";
import {
  type ChartMetadata,
  ChartMetadataSchema,
  ChartRepoIndexSchema,
  type ChartRepoRelease,
  type ChartUpdateContext,
  type HelmRepoChartConfig,
  type OciRegistryChartConfig,
  type RemoteArchiveChartConfig,
  RemoteChartSource,
} from "../libs/types.ts";
import { typeifyChart } from "./typeify.ts";
import { bold, gray, green, red } from "@std/fmt/colors";
import { checkAndImport } from "../mod.ts";
import { Opt, Str, typedParse } from "../deps/schema.ts";

interface ChartUpdateFailure {
  isSuccess: false;
  reason: unknown;
}

interface ChartUpdateSuccess {
  isSuccess: true;
  isUpdated: boolean;
  fromVersion?: string;
  toVersion: string;
}

type ChartUpdateResult = ChartUpdateFailure | ChartUpdateSuccess;

async function getCurrentChartMetadata(
  chartPath: string,
): Promise<ChartMetadata | undefined> {
  if (await fsExists(chartPath)) {
    const currentChartMetaRaw = parseYaml(
      await Deno.readTextFile(joinPath(chartPath, "Chart.yaml")),
    );
    const currentChartMetaResult = typedParse(
      ChartMetadataSchema,
      currentChartMetaRaw,
    );

    if (!currentChartMetaResult.isSuccess) {
      throw new Error(
        `Failed validating "Chart.yaml" from ${chartPath}. Errors:\n${
          [...currentChartMetaResult.errors].map((e) => `  - at path ${JSON.stringify(e.path)}: ${e.message}`).join(
            "\n",
          )
        }`,
      );
    }

    return currentChartMetaResult.value;
  }
}

const remoteRepoIndexYamlCache = new Map<string, Promise<string>>();
function fetchRemoteRepoIndexYaml(url: string): Promise<string> {
  const cachedPromise = remoteRepoIndexYamlCache.get(url);

  if (!cachedPromise) {
    const promise = fetch(url).then((r) => r.text());
    remoteRepoIndexYamlCache.set(url, promise);
    return promise;
  }

  return cachedPromise;
}

async function updateChart(
  ctx: ChartUpdateContext & {
    chartName: string;
  },
): Promise<ChartUpdateResult> {
  const {
    chartName,
    chartPath,
    typesPath,
    remote,
  } = ctx;
  const result = await (() => {
    switch (remote.source) {
      case RemoteChartSource.HelmRepo:
        return updateHelmRepoChart({
          chartName,
          chartPath,
          typesPath,
          remote,
        });
      case RemoteChartSource.OciRegistry:
        return updateOciChart({
          chartPath,
          typesPath,
          remote,
        });
      case RemoteChartSource.RemoteArchive:
        return updateRemoteArchiveChart({
          chartPath,
          typesPath,
          remote,
        });
    }
  })();

  if (result.isSuccess && remote.onUpdated) {
    await remote.onUpdated(ctx);
  }

  return result;
}

async function updateRemoteArchiveChart({
  chartPath,
  typesPath,
  remote,
}: {
  chartPath: string;
  typesPath: string;
  remote: RemoteArchiveChartConfig;
}): Promise<ChartUpdateResult> {
  const currentChartMeta = await getCurrentChartMetadata(chartPath);

  if (currentChartMeta && currentChartMeta.version === remote.version) {
    return {
      isSuccess: true,
      isUpdated: false,
      toVersion: remote.version,
    };
  }

  const tempDir = await Deno.makeTempDir();
  const { archiveUrl } = remote;

  try {
    if (archiveUrl.endsWith(".zip")) {
      await inheritExec({
        cmd: [
          "curl",
          "-Lso",
          "./temp.zip",
          remote.archiveUrl,
        ],
        cwd: tempDir,
      });

      await inheritExec({
        cmd: [
          "unzip",
          "-qq",
          "./temp.zip",
          `*/${remote.extractPath}/*`,
          "-d",
          "out",
        ],
        cwd: tempDir,
      });
    } else if (archiveUrl.endsWith(".tgz") || archiveUrl.endsWith(".tar.gz")) {
      await Deno.mkdir(joinPath(tempDir, "out"));

      await inheritExec({
        cmd: ["bash"],
        stdin: {
          pipe: `curl -Ls ${quoteShell([archiveUrl])} | tar -xz -C ${quoteShell([joinPath(tempDir, "out")])}`,
        },
      });
    } else {
      throw new Error(`Unsupport archive with URL: ${archiveUrl}`);
    }

    if (currentChartMeta) {
      await Deno.remove(chartPath, { recursive: true });
    }

    await inheritExec({
      cmd: ["bash"],
      cwd: tempDir,
      stdin: {
        pipe: `mv ./out/*/"${remote.extractPath}" "${chartPath}"`,
      },
    });

    if (remote.onDownloaded) {
      await remote.onDownloaded({ chartPath, typesPath, remote });
    }
    await typeifyChart(chartPath, typesPath);

    return {
      isSuccess: true,
      isUpdated: true,
      fromVersion: currentChartMeta?.appVersion,
      toVersion: remote.version,
    };
  } catch (e) {
    return {
      isSuccess: false,
      reason: e,
    };
  } finally {
    await Deno.remove(tempDir, { recursive: true })
      .catch(() => Promise.resolve());
  }
}

async function updateOciChart(
  {
    chartPath,
    typesPath,
    remote,
  }: {
    chartPath: string;
    typesPath: string;
    remote: OciRegistryChartConfig;
  },
): Promise<ChartUpdateResult> {
  const currentChartMeta = await getCurrentChartMetadata(chartPath);

  if (currentChartMeta && currentChartMeta.appVersion === remote.version) {
    return {
      isSuccess: true,
      isUpdated: false,
      toVersion: remote.version,
    };
  }

  const tempDir = await Deno.makeTempDir();

  try {
    await inheritExec({
      cmd: ["helm", "pull", remote.ociRef, "--version", remote.version],
      env: {
        HELM_EXPERIMENTAL_OCI: "1",
      },
      cwd: tempDir,
    });

    await Promise.all(
      Array
        .from(expandGlobSync("*.tgz", {
          root: tempDir,
        }))
        .map(async (entry) => {
          const subChartsPath = dirname(entry.path);
          await inheritExec({
            cmd: [
              "tar",
              "-xz",
              "--warning=no-timestamp",
              "-C",
              subChartsPath,
              "-f",
              entry.path,
            ],
          });
          await Deno.remove(entry.path);
        }),
    );

    if (currentChartMeta) {
      await Deno.remove(chartPath, { recursive: true });
    }

    await inheritExec({
      cmd: ["bash"],
      stdin: {
        pipe: `mv "${tempDir}/"* "${chartPath}"`,
      },
    });

    if (remote.onDownloaded) {
      await remote.onDownloaded({ chartPath, typesPath, remote });
    }
    await typeifyChart(chartPath, typesPath);

    return {
      isSuccess: true,
      isUpdated: true,
      fromVersion: currentChartMeta?.appVersion,
      toVersion: remote.version,
    };
  } catch (e) {
    return {
      isSuccess: false,
      reason: e,
    };
  } finally {
    await Deno.remove(tempDir, { recursive: true })
      .catch(() => Promise.resolve());
  }
}

async function updateHelmRepoChart({
  chartName,
  chartPath,
  typesPath,
  remote,
}: {
  chartName: string;
  chartPath: string;
  typesPath: string;
  remote: HelmRepoChartConfig;
}): Promise<ChartUpdateResult> {
  const { remoteRepoUrl, remoteName } = remote;
  const currentChartMeta = await getCurrentChartMetadata(chartPath);

  const remoteRepoIndexRaw = parseYaml(
    await fetchRemoteRepoIndexYaml(remoteRepoUrl),
  );
  const remoteRepoIndexResult = typedParse(
    ChartRepoIndexSchema,
    remoteRepoIndexRaw,
  );

  if (!remoteRepoIndexResult.isSuccess) {
    throw new Error(
      `Failed validating "index.yaml" for "${chartName}" repo at "${remoteRepoUrl}". Errors:\n${
        [...remoteRepoIndexResult.errors].map((e) => `  - at path ${JSON.stringify(e.path)}: ${e.message}`).join("\n")
      }`,
    );
  }

  const remoteRepoIndex = remoteRepoIndexResult.value;
  const entries = remoteRepoIndex.entries[remoteName];

  if (!entries) {
    return {
      isSuccess: false,
      reason: `Entry "${remoteName}" does not exist on "${remoteRepoUrl}"`,
    };
  }

  const filteredEntries = (remote.apiVersion) ? entries.filter((e) => e.apiVersion === remote.apiVersion) : entries;

  const allVersionsMap = filteredEntries.reduce((map, entry) => {
    const maybeSemver = semverTryParse(entry.version);

    if (maybeSemver !== undefined) {
      return map.set(maybeSemver, entry);
    }

    return map;
  }, new Map<SemVer, ChartRepoRelease>());

  const allVersions = Array.from(allVersionsMap.keys());
  const range = typeof remote.version === "string" ? semverParseRange(remote.version) : remote.version;

  const maxSatisfyingVersion = maxSatisfyingSemver(
    allVersions,
    range,
  );

  if (maxSatisfyingVersion === undefined) {
    return {
      isSuccess: false,
      reason: `No release satisfies version "${remote.version}". All available releases: ${
        allVersions.map((v) => semverFormat(v)).join(", ")
      }`,
    };
  }

  const maxSatisfyingRelease = allVersionsMap.get(
    maxSatisfyingVersion,
  )!;

  if (
    !currentChartMeta ||
    maxSatisfyingRelease.version !== currentChartMeta.version
  ) {
    const remoteReleaseUrl = maxSatisfyingRelease.urls[0];

    if (!remoteReleaseUrl) {
      return {
        isSuccess: false,
        reason: `Empty URL for release "${maxSatisfyingRelease.version}"`,
      };
    }

    const resolvedRemoteReleaseUrl = (new URL(remoteReleaseUrl, remoteRepoUrl)).href;

    const tempDir = await Deno.makeTempDir();

    try {
      await inheritExec({
        cmd: ["bash"],
        stdin: {
          pipe: `curl -Ls ${quoteShell([resolvedRemoteReleaseUrl])} | tar -xz --strip-components 1 -C ${
            quoteShell([tempDir])
          }`,
        },
      });

      if (currentChartMeta) {
        await Deno.remove(chartPath, { recursive: true });
      }

      await inheritExec({
        cmd: ["cp", "-r", tempDir, chartPath],
      });

      if (remote.onDownloaded) {
        await remote.onDownloaded({ chartPath, typesPath, remote });
      }
      await typeifyChart(chartPath, typesPath);

      return {
        isSuccess: true,
        isUpdated: true,
        fromVersion: currentChartMeta ? currentChartMeta.version : undefined,
        toVersion: maxSatisfyingRelease.version,
      };
    } finally {
      await Deno.remove(tempDir, { recursive: true })
        .catch(() => Promise.resolve());
    }
  } else {
    return {
      isSuccess: true,
      isUpdated: false,
      fromVersion: currentChartMeta ? currentChartMeta.version : undefined,
      toVersion: maxSatisfyingRelease.version,
    };
  }
}

export default createCliAction(
  {
    manifest: Str({
      description: "Path to the manifest module",
      examples: ["./manifest.ts"],
    }),
    charts: Str({
      description: "Path to the directory where all charts are unpacked into",
      examples: ["./charts"],
    }),
    types: Str({
      description: "Path to the destination directory where types will be generated into",
      examples: ["./types"],
    }),
    only: Opt(Str({
      description: "Optional filter which partially matches the name of only a certain chart to update",
    })),
  },
  async ({ manifest, charts: chartsPath, types: typesPath, only }) => {
    const resolvedManifest = resolvePath(manifest);
    const resolvedChartsPath = resolvePath(chartsPath);
    const resolvedTypesPath = resolvePath(typesPath);

    if (!(await fsExists(resolvedChartsPath))) {
      console.error(
        `Charts path does not exist at '${resolvedChartsPath}'`,
      );
      return ExitCode.One;
    }

    if (!(await fsExists(resolvedTypesPath))) {
      console.error(
        `Types path does not exist at '${resolvedTypesPath}'`,
      );
      return ExitCode.One;
    }

    const manifestModule = await checkAndImport(resolvedManifest);

    if (!manifestModule.default) {
      console.error(
        `Maniest module at '${resolvedManifest}' does not have a valid default export`,
      );
      return ExitCode.One;
    }

    const remoteCharts = manifestModule.default;

    const promises = Object
      .keys(remoteCharts)
      .filter((chartName) => only ? chartName.indexOf(only) !== -1 : true)
      .map((chartName) => {
        const tag = `[${chartName}]`;
        const remote = remoteCharts[chartName];
        const chartPath = joinPath(resolvedChartsPath, chartName);

        return async () => {
          try {
            const result = await updateChart({
              chartName,
              remote,
              chartPath,
              typesPath: resolvedTypesPath,
            });

            if (result.isSuccess) {
              if (result.isUpdated) {
                return [
                  green(tag),
                  "Updated chart from",
                  green(result.fromVersion ?? "never"),
                  "to",
                  green(result.toVersion),
                ];
              } else {
                return [
                  gray(tag),
                  "Already up to date at version",
                  result.toVersion,
                ];
              }
            } else {
              return [
                bold(red(tag)),
                "Failed updating due to",
                result.reason,
              ];
            }
          } catch (e) {
            return [
              bold(red(tag)),
              "Failed updating due to an unexpected error:",
              String(e),
            ];
          }
        };
      })
      .map((fn) => fn().then((result) => console.log.apply(console, result)));

    await Promise.all(promises);

    return ExitCode.Zero;
  },
);
