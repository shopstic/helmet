import { inheritExec } from "../deps/exec_utils.ts";
import { expandGlobSync, fsExists } from "../deps/std_fs.ts";
import { dirname, joinPath, resolvePath } from "../deps/std_path.ts";
import { parseYaml } from "../deps/std_yaml.ts";
import { Type } from "../deps/typebox.ts";
import { validate } from "../deps/validation_utils.ts";
import { coerceSemver, maxSatisfyingSemver, SemVer } from "../deps/semver.ts";
import { quoteShellCmd } from "../deps/quote_shell.ts";
import { createCliAction, ExitCode } from "../deps/cli_utils.ts";
import {
  ChartMetadata,
  ChartMetadataSchema,
  ChartRepoIndexSchema,
  ChartRepoRelease,
  HelmRepoChartConfig,
  OciRegistryChartConfig,
  RemoteArchiveChartConfig,
  RemoteChartConfig,
  RemoteChartSource,
} from "../libs/types.ts";
import { typeifyChart } from "./typeify.ts";
import { bold, gray, green, red } from "../deps/std_fmt_colors.ts";

interface ChartUpdateFailure {
  isSuccess: false;
  reason: string;
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
    const currentChartMetaResult = validate(
      ChartMetadataSchema,
      currentChartMetaRaw,
    );

    if (!currentChartMetaResult.isSuccess) {
      throw new Error(
        `Failed validating "Chart.yaml" from ${chartPath}. Errors:\n${
          currentChartMetaResult.errorsToString({
            separator: "\n",
            dataVar: "  -",
          })
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

function updateChart({
  chartName,
  chartPath,
  typesPath,
  remote,
}: {
  chartName: string;
  chartPath: string;
  typesPath: string;
  remote: RemoteChartConfig;
}): Promise<ChartUpdateResult> {
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
        run: {
          cmd: [
            "curl",
            "-Lso",
            "./temp.zip",
            remote.archiveUrl,
          ],
          cwd: tempDir,
        },
      });

      await inheritExec({
        run: {
          cmd: [
            "unzip",
            "-qq",
            "./temp.zip",
            `*/${remote.extractPath}/*`,
            "-d",
            "out",
          ],
          cwd: tempDir,
        },
      });
    } else if (archiveUrl.endsWith(".tgz") || archiveUrl.endsWith(".tar.gz")) {
      await Deno.mkdir(joinPath(tempDir, "out"));

      await inheritExec({
        run: {
          cmd: ["bash"],
        },
        stdin: `curl -Ls ${quoteShellCmd([archiveUrl])} | tar -xz -C ${
          quoteShellCmd([joinPath(tempDir, "out")])
        }`,
      });
    } else {
      throw new Error(`Unsupport archive with URL: ${archiveUrl}`);
    }

    if (currentChartMeta) {
      await Deno.remove(chartPath, { recursive: true });
    }

    await inheritExec({
      run: {
        cmd: ["bash"],
        cwd: tempDir,
      },
      stdin: `mv ./out/*/"${remote.extractPath}" "${chartPath}"`,
    });

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
      reason: e.toString(),
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
    const fullOciRef = `${remote.ociRef}:${remote.version}`;
    await inheritExec({
      run: {
        cmd: ["helm", "chart", "pull", fullOciRef],
        env: {
          HELM_EXPERIMENTAL_OCI: "1",
        },
      },
    });

    await inheritExec({
      run: {
        cmd: ["helm", "chart", "export", fullOciRef, "-d", tempDir],
        env: {
          HELM_EXPERIMENTAL_OCI: "1",
        },
      },
    });

    await Promise.all(
      Array
        .from(expandGlobSync("*/charts/*.tgz", {
          root: tempDir,
        }))
        .map(async (entry) => {
          const subChartsPath = dirname(entry.path);
          await inheritExec({
            run: {
              cmd: ["tar", "-xz", "-C", subChartsPath, "-f", entry.path],
            },
          });
          await Deno.remove(entry.path);
        }),
    );

    if (currentChartMeta) {
      await Deno.remove(chartPath, { recursive: true });
    }

    await inheritExec({
      run: {
        cmd: ["bash"],
      },
      stdin: `mv "${tempDir}/"* "${chartPath}"`,
    });

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
      reason: e.toString(),
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
  const remoteRepoIndexResult = validate(
    ChartRepoIndexSchema,
    remoteRepoIndexRaw,
  );

  if (!remoteRepoIndexResult.isSuccess) {
    throw new Error(
      `Failed validating "index.yaml" for "${chartName}" repo at "${remoteRepoUrl}". Errors:\n${
        remoteRepoIndexResult.errorsToString({
          separator: "\n",
          dataVar: "  -",
        })
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

  const filteredEntries = (remote.apiVersion)
    ? entries.filter((e) => e.apiVersion === remote.apiVersion)
    : entries;

  const allVersionsMap = filteredEntries.reduce((map, entry) => {
    const maybeSemver = coerceSemver(entry.version);

    if (maybeSemver !== null) {
      return map.set(maybeSemver, entry);
    }

    return map;
  }, new Map<SemVer, ChartRepoRelease>());

  const allVersions = Array.from(allVersionsMap.keys());

  const maxSatisfyingVersion = maxSatisfyingSemver(
    allVersions,
    remote.version,
  );

  if (maxSatisfyingVersion === null) {
    return {
      isSuccess: false,
      reason:
        `No release satisfies version "${remote.version}". All available releases: ${
          allVersions.map((v) => v.version).join(", ")
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

    const resolvedRemoteReleaseUrl =
      (new URL(remoteReleaseUrl, remoteRepoUrl)).href;

    const tempDir = await Deno.makeTempDir();

    try {
      await inheritExec({
        run: {
          cmd: ["bash"],
        },
        stdin: `curl -Ls ${
          quoteShellCmd([resolvedRemoteReleaseUrl])
        } | tar -xz --strip-components 1 -C ${quoteShellCmd([tempDir])}`,
      });

      if (currentChartMeta) {
        await Deno.remove(chartPath, { recursive: true });
      }

      await inheritExec({
        run: { cmd: ["cp", "-r", tempDir, chartPath] },
      });

      await typeifyChart(chartPath, typesPath);

      return {
        isSuccess: true,
        isUpdated: true,
        fromVersion: (currentChartMeta) ? currentChartMeta.version : undefined,
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
      fromVersion: (currentChartMeta) ? currentChartMeta.version : undefined,
      toVersion: maxSatisfyingRelease.version,
    };
  }
}

export default createCliAction(
  Type.Object({
    manifest: Type.String({
      description: "Path to the manifest module",
      examples: ["./manifest.ts"],
    }),
    charts: Type.String({
      description: "Path to the directory where all charts are unpacked into",
      examples: ["./charts"],
    }),
    types: Type.String({
      description:
        "Path to the destination directory where types will be generated into",
      examples: ["./types"],
    }),
    only: Type.Optional(Type.String({
      description:
        "Optional filter which partially matches the name of only a certain chart to update",
    })),
  }),
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

    const manifestModule = await import(resolvedManifest);

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
              e.message,
            ];
          }
        };
      })
      .map((fn) => fn().then((result) => console.log.apply(console, result)));

    await Promise.all(promises);

    return ExitCode.Zero;
  },
);
