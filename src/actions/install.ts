import { captureExec, inheritExec, printErrLines, printOutLines } from "@wok/utils/exec";
import { validate } from "@wok/utils/validation";
import { type Static, type TObject, Type } from "@wok/typebox";
import { join as joinPath, resolve as resolvePath } from "@std/path";
import { expandGlobSync } from "@std/fs";
import { createCliAction, ExitCode } from "@wok/utils/cli";
import { cyan, gray } from "@std/fmt/colors";
import { HelmLsResultSchema } from "../libs/iac_utils.ts";
import { TextLineStream } from "@std/streams/text-line-stream";

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

  console.log(`Executing:`, cyan(helmUpgradeCmd.join(" ")));

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
  name: Type.String({
    description:
      "Helm release base name. This will be used as the prefx of the different sub-releases (*-crds, *-namespaces and *-resources)",
  }),
  namespace: Type.String({
    description: "The namespace where the Secrets for Helm releases are stored",
  }),
  source: Type.String({
    description: "Path to the compiled instance generated from `helmet compile ...`",
  }),
  wait: Type.Optional(Type.Boolean({
    description: "Whether to pass --wait to the underlying `helm upgrade ...` process",
    default: false,
    examples: [false],
  })),
  atomic: Type.Optional(Type.Boolean({
    description: "Whether to pass --atomic to the underlying `helm upgrade ...` process",
    default: false,
    examples: [false],
  })),
  cleanupOnFail: Type.Optional(Type.Boolean({
    description: "Whether to pass --cleanup-on-fail to the underlying `helm upgrade ...` process",
    default: false,
    examples: [false],
  })),
  force: Type.Optional(Type.Boolean({
    description: "Whether to pass --force to the underlying `helm upgrade ...` process",
    default: false,
    examples: [false],
  })),
  timeout: Type.Optional(Type.String({
    description: "Pass --timeout to the underlying `helm upgrade ...` process",
    default: "",
    examples: ["5m0s"],
  })),
  createNamespace: Type.Optional(Type.Boolean({
    description: "Whether to pass --create-namespace to the underlying `helm upgrade ...` process",
    default: false,
    examples: [false],
  })),
  debug: Type.Optional(Type.Boolean({
    description: "Whether to pass --debug to the underlying `helm upgrade ...` process",
    default: false,
    examples: [false],
  })),
};

export async function install(
  {
    name,
    namespace,
    source,
    wait = false,
    atomic = false,
    cleanupOnFail = false,
    force = false,
    createNamespace = false,
    debug = false,
    timeout,
  }: Static<TObject<typeof ParamsSchema>>,
) {
  const resolvedSource = resolvePath(source);

  console.log(`Installing ${resolvedSource}`);
  const crdsRenderedPath = joinPath(resolvedSource, "crds/rendered");

  const hasCrds = Array
    .from(expandGlobSync("*.yaml", {
      root: crdsRenderedPath,
    })).length > 0;

  if (hasCrds) {
    const kubectlApplyCmd = [
      "kubectl",
      "apply",
      "--server-side",
      "--force-conflicts",
      "-f",
      crdsRenderedPath,
    ];

    console.log("Executing:", cyan(kubectlApplyCmd.join(" ")));
    const tag = gray(`[$ ${kubectlApplyCmd.slice(0, 2).join(" ")} ...]`);
    await inheritExec({
      cmd: kubectlApplyCmd,
      stderr: {
        read: printErrLines((line) => `${tag} ${line}`),
      },
      stdout: {
        read: printOutLines((line) => `${tag} ${line}`),
      },
    });
  }

  await helmInstall({
    name: `${name}-namespaces`,
    namespace,
    chartPath: joinPath(resolvedSource, "namespaces"),
    wait,
    atomic,
    cleanupOnFail,
    force,
    timeout,
    createNamespace,
    debug,
  });

  /* await inheritExec({
      cmd: [
        "kubectl",
        "apply",
        "--dry-run=client",
        "-f",
        joinPath(source, "resources", "templates"),
      ],
    });
 */
  await helmInstall({
    name: `${name}-resources`,
    namespace,
    chartPath: joinPath(resolvedSource, "resources"),
    wait,
    atomic,
    cleanupOnFail,
    force,
    timeout,
    createNamespace,
    debug,
  });
}

export default createCliAction(ParamsSchema, async (args) => {
  await install(args);
  return ExitCode.Zero;
});
