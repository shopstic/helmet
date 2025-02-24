import { captureExec, inheritExec, printErrLines, printOutLines } from "@wok/utils/exec";
import { join as joinPath, resolve as resolvePath } from "@std/path";
import { expandGlob } from "@std/fs";
import { createCliAction, ExitCode } from "@wok/utils/cli";
import { bold, cyan, gray, yellow } from "@std/fmt/colors";
import { HelmLsResultSchema } from "../libs/iac_utils.ts";
import { TextLineStream } from "@std/streams/text-line-stream";
import { Arr, Bool, Obj, Opt, Str, validate } from "../deps/schema.ts";
import { CompiledBundleMetaSchema } from "../libs/types.ts";
import { createK8sConfigMap } from "../deps/k8s.ts";
import { calculateDirectoryDigest, getCurrentKubeContext } from "../libs/cli_utils.ts";
import { stringifyYamlRelaxed } from "../libs/yaml_utils.ts";
import { getDefaultLogger, type Logger } from "@wok/utils/logger";
import { fetchCurrentWhitelist, type HelmetWhitelist } from "./whitelist_instance.ts";
import { arrayPartition } from "@wok/utils/collection";

function generateDigestConfigMapName(name: string) {
  return `run.helmet.digest.v1.${name}`;
}

function createDigestConfigMap(
  { name, namespace, digest }: { name: string; namespace: string; digest: string },
) {
  return createK8sConfigMap({
    metadata: {
      name: generateDigestConfigMapName(name),
      namespace,
    },
    data: {
      digest,
    },
  });
}

async function getCurrentDigest(
  { name, namespace }: { name: string; namespace: string },
): Promise<string | undefined> {
  try {
    return (await captureExec({
      cmd: [
        "kubectl",
        "get",
        "-n",
        namespace,
        "configmap",
        `run.helmet.digest.v1.${name}`,
        "-o",
        "jsonpath={.data.digest}",
      ],
    })).out.trim();
  } catch {
    return undefined;
  }
}

async function deleteDigestConfigMap(
  { name, namespace }: { name: string; namespace: string },
): Promise<void> {
  try {
    await inheritExec({
      cmd: ["kubectl", "delete", "-n", namespace, "configmap", generateDigestConfigMapName(name)],
      stderr: {
        ignore: true,
      },
      stdout: {
        ignore: true,
      },
    });
  } catch {
    // Ignore
  }
}

async function helmInstall(
  {
    name,
    namespace,
    chartPath,
    wait,
    cleanupOnFail,
    atomic,
    timeout,
    force,
    createNamespace,
    debug,
    logger,
  }: {
    name: string;
    namespace: string;
    chartPath: string;
    wait: boolean;
    cleanupOnFail: boolean;
    atomic: boolean;
    timeout?: string;
    force: boolean;
    createNamespace: boolean;
    debug: boolean;
    logger: Logger;
  },
) {
  const helmLsResultRaw = JSON.parse(
    (await captureExec({
      cmd: ["helm", "ls", "-a", "-n", namespace, "-o=json"],
    })).out,
  );

  const helmLsResult = validate(HelmLsResultSchema, helmLsResultRaw);

  if (!helmLsResult.isSuccess) {
    throw new Error('Failed validating result of "helm ls" command');
  }

  const currentRelease = helmLsResult.value.find((i) => i.name === name);

  const helmUpgradeCmd = currentRelease
    ? [
      "helm",
      "upgrade",
      "--disable-openapi-validation",
      "-n",
      namespace,
      "--history-max=2",
      ...(wait ? ["--wait"] : []),
      ...(cleanupOnFail ? ["--cleanup-on-fail"] : []),
      ...(atomic ? ["--atomic"] : []),
      ...(timeout ? [`--timeout=${timeout}`] : []),
      ...(force ? ["--force"] : []),
      ...(createNamespace ? ["--create-namespace"] : []),
      ...(debug ? ["--debug"] : []),
      name,
      chartPath,
    ]
    : [
      "helm",
      "install",
      "--disable-openapi-validation",
      "-n",
      namespace,
      ...(wait ? ["--wait"] : []),
      ...(atomic ? ["--atomic"] : []),
      ...(timeout ? [`--timeout=${timeout}`] : []),
      ...(createNamespace ? ["--create-namespace"] : []),
      ...(debug ? ["--debug"] : []),
      name,
      chartPath,
    ];

  logger.info?.(`Executing:`, cyan(helmUpgradeCmd.join(" ")));

  const tag = gray(`[$ ${helmUpgradeCmd.slice(0, 2).join(" ")} ...]`);
  let redactingOutput = false;
  await inheritExec({
    cmd: helmUpgradeCmd,
    stdout: {
      async read(readable) {
        for await (
          const line of readable
            .pipeThrough(new TextDecoderStream())
            .pipeThrough(new TextLineStream())
        ) {
          if (
            debug && !redactingOutput &&
            line.startsWith("USER-SUPPLIED VALUES:")
          ) {
            redactingOutput = true;
          }

          if (!redactingOutput) {
            console.error(`${tag} ${line}`);
          }
        }
      },
    },
    stderr: {
      read: printErrLines((line) => `${tag} ${line}`),
    },
  });
}

export const ParamsSchema = {
  wait: Opt(
    Bool({
      description: "Whether to pass --wait to the underlying `helm upgrade ...` process",
      examples: [false],
    }),
    false,
  ),
  atomic: Opt(
    Bool({
      description: "Whether to pass --atomic to the underlying `helm upgrade ...` process",
      examples: [false],
    }),
    false,
  ),
  cleanupOnFail: Opt(
    Bool({
      description: "Whether to pass --cleanup-on-fail to the underlying `helm upgrade ...` process",
      examples: [false],
    }),
    false,
  ),
  force: Opt(
    Bool({
      description: "Whether to pass --force to the underlying `helm upgrade ...` process",
      examples: [false],
    }),
    false,
  ),
  timeout: Opt(
    Str({
      description: "Pass --timeout to the underlying `helm upgrade ...` process",
      examples: ["5m0s"],
    }),
    "",
  ),
  createNamespace: Opt(
    Bool({
      description: "Whether to pass --create-namespace to the underlying `helm upgrade ...` process",
      examples: [false],
    }),
    false,
  ),
  debug: Opt(
    Bool({
      description: "Whether to pass --debug to the underlying `helm upgrade ...` process",
      examples: [false],
    }),
    false,
  ),
  ignorePurity: Opt(
    Bool({
      description: "Whether to ignore the purity of the bundle and install it anyway",
      examples: [false],
    }),
    false,
  ),
  _: Arr(Str(), {
    description: "Paths to the compiled instances generated from `helmet compile ...`",
    title: "sources",
    minItems: 1,
  }),
};

const ParamsSchemaObj = Obj(ParamsSchema);
type ParamsSchema = typeof ParamsSchemaObj.infer;

interface Installation {
  name: string;
  namespace: string;
  crdsPath: string;
  namespacesPath: string;
  resourcesPath: string;
  shouldInstallCrds: boolean;
  shouldInstallNamespaces: boolean;
  shouldInstallResources: boolean;
}

async function prepare(
  { source, ignorePurity, logger, whitelist }: {
    source: string;
    ignorePurity: boolean;
    logger: Logger;
    whitelist: HelmetWhitelist;
  },
): Promise<Installation | null> {
  const resolvedSource = resolvePath(source);
  const metaPath = resolvePath(joinPath(resolvedSource, "meta.json"));
  const crdsPath = joinPath(resolvedSource, "crds");
  const namespacesPath = joinPath(resolvedSource, "namespaces");
  const resourcesPath = joinPath(resolvedSource, "resources");
  let currentCrdsDigest: string | undefined;
  let currentNamespacesDigest: string | undefined;
  let currentResourcesDigest: string | undefined;

  let newCrdsDigest: string | undefined;
  let newNamespacesDigest: string | undefined;
  let newResourcesDigest: string | undefined;

  logger.info?.(`Preparing ${cyan(resolvedSource)}`);
  const metaJson = JSON.parse(await Deno.readTextFile(metaPath));
  const metaValidation = validate(CompiledBundleMetaSchema, metaJson);

  if (!metaValidation.isSuccess) {
    logger.error?.(
      "Failed validating compiled bundle metadata",
      metaPath,
      JSON.stringify(metaValidation.errors, null, 2),
    );
    return null;
  }

  const { pure, name, namespace } = metaValidation.value;
  const installLogger = logger.prefixed(gray(name));

  if (!whitelist.set.has(name)) {
    const currentKubeContext = await getCurrentKubeContext();
    installLogger.error?.("Bundle instance", bold(yellow(name)), "is not whitelisted");
    installLogger.error?.("Current Kubernetes context is", cyan(currentKubeContext.trim()));
    installLogger.error?.("The current whitelisted set is", whitelist.set);
    return null;
  }

  if (pure) {
    [
      newCrdsDigest,
      newNamespacesDigest,
      newResourcesDigest,
    ] = await Promise.all([
      calculateDirectoryDigest(crdsPath),
      calculateDirectoryDigest(namespacesPath),
      calculateDirectoryDigest(resourcesPath),
    ]);

    if (ignorePurity) {
      installLogger.info?.("Bundle is marked pure but --ignore-purity is set, skipping digest comparison");
    } else {
      installLogger.info?.("Bundle is marked pure, fetching current digests and calculating new digests...");
      [
        currentCrdsDigest,
        currentNamespacesDigest,
        currentResourcesDigest,
      ] = await Promise.all([
        getCurrentDigest({ name: `${name}-crds`, namespace }),
        getCurrentDigest({ name: `${name}-namespaces`, namespace }),
        getCurrentDigest({ name: `${name}-resources`, namespace }),
      ]);
      installLogger.debug?.("CRDs digest", currentCrdsDigest, "vs", newCrdsDigest);
      installLogger.debug?.("Namespaces digest", currentNamespacesDigest, "vs", newNamespacesDigest);
      installLogger.debug?.("Resources digest", currentResourcesDigest, "vs", newResourcesDigest);
    }
  }

  const crdsRenderedPath = joinPath(crdsPath, "rendered");
  const hasCrds = (await Array.fromAsync(expandGlob("*.yaml", { root: crdsRenderedPath }))).length > 0;
  const shouldInstallCrds = hasCrds && (newCrdsDigest === undefined || newCrdsDigest !== currentCrdsDigest);
  const shouldInstallNamespaces = newNamespacesDigest === undefined || newNamespacesDigest !== currentNamespacesDigest;
  const shouldInstallResources = newResourcesDigest === undefined || newResourcesDigest !== currentResourcesDigest;

  if (shouldInstallCrds && newCrdsDigest !== undefined) {
    await Deno.writeTextFile(
      joinPath(crdsRenderedPath, `digest-${newCrdsDigest}.yaml`),
      stringifyYamlRelaxed(createDigestConfigMap({ name: `${name}-crds`, namespace, digest: newCrdsDigest })),
    );
  }

  if (shouldInstallNamespaces && newNamespacesDigest !== undefined) {
    await Deno.writeTextFile(
      joinPath(namespacesPath, "rendered", `digest-${newNamespacesDigest}.yaml`),
      stringifyYamlRelaxed(
        createDigestConfigMap({ name: `${name}-namespaces`, namespace, digest: newNamespacesDigest }),
      ),
    );
  }

  if (shouldInstallResources && newResourcesDigest !== undefined) {
    await Deno.writeTextFile(
      joinPath(resourcesPath, "rendered", `digest-${newResourcesDigest}.yaml`),
      stringifyYamlRelaxed(
        createDigestConfigMap({ name: `${name}-resources`, namespace, digest: newResourcesDigest }),
      ),
    );
  }

  return {
    name,
    namespace,
    shouldInstallCrds,
    shouldInstallNamespaces,
    shouldInstallResources,
    crdsPath,
    namespacesPath,
    resourcesPath,
  };
}

export async function install(
  {
    installation: {
      name,
      namespace,
      shouldInstallCrds,
      shouldInstallNamespaces,
      shouldInstallResources,
      crdsPath,
      namespacesPath,
      resourcesPath,
    },
    params: {
      wait,
      atomic,
      cleanupOnFail,
      force,
      createNamespace,
      debug,
      timeout,
    },
    logger,
  }: { installation: Installation; params: Omit<ParamsSchema, "_">; logger: Logger },
): Promise<void> {
  if (shouldInstallCrds) {
    const kubectlApplyCmd = [
      "kubectl",
      "apply",
      "--server-side",
      "--force-conflicts",
      "-f",
      joinPath(crdsPath, "rendered"),
    ];

    logger.info?.("Executing:", cyan(kubectlApplyCmd.join(" ")));
    const tag = gray(`[$ ${kubectlApplyCmd.slice(0, 2).join(" ")} ...]`);

    try {
      await inheritExec({
        cmd: kubectlApplyCmd,
        stderr: {
          read: printErrLines((line) => `${tag} ${line}`),
        },
        stdout: {
          read: printOutLines((line) => `${tag} ${line}`),
        },
      });
    } catch (e) {
      await deleteDigestConfigMap({ name: `${name}-crds`, namespace });
      throw e;
    }
  } else {
    logger.info?.("Skipping CRDs, no changes detected");
  }

  if (shouldInstallNamespaces) {
    try {
      await helmInstall({
        name: `${name}-namespaces`,
        namespace,
        chartPath: namespacesPath,
        wait,
        atomic,
        cleanupOnFail,
        force,
        timeout,
        createNamespace,
        debug,
        logger,
      });
    } catch (e) {
      await deleteDigestConfigMap({ name: `${name}-namespaces`, namespace });
      throw e;
    }
  } else {
    logger.info?.("Skipping namespaces, no changes detected");
  }

  if (shouldInstallResources) {
    try {
      await helmInstall({
        name: `${name}-resources`,
        namespace,
        chartPath: resourcesPath,
        wait,
        atomic,
        cleanupOnFail,
        force,
        timeout,
        createNamespace,
        debug,
        logger,
      });
    } catch (e) {
      await deleteDigestConfigMap({ name: `${name}-resources`, namespace });
      throw e;
    }
  } else {
    logger.info?.("Skipping resources, no changes detected");
  }
}

export default createCliAction(ParamsSchema, async ({ _: sources, ...params }) => {
  const logger = getDefaultLogger();

  const whitelist = await fetchCurrentWhitelist();

  const [installations, invalid] = arrayPartition(
    await Promise.all(
      sources.map((source) => prepare({ source, logger, whitelist, ignorePurity: params.ignorePurity })),
    ),
    (i) => i !== null,
  );

  if (invalid.length > 0) {
    return ExitCode.One;
  }

  for (const installation of installations) {
    const installLogger = logger.prefixed(gray(installation.name));
    if (
      !installation.shouldInstallCrds && !installation.shouldInstallNamespaces && !installation.shouldInstallResources
    ) {
      installLogger.info?.("Bundle has not changed, skipping installation");
      continue;
    }

    await install({ params, installation, logger: installLogger });
  }

  return ExitCode.Zero;
});
