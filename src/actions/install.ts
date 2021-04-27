import { captureExec, inheritExec } from "../deps/exec_utils.ts";
import { validate } from "../deps/validation_utils.ts";
import { Static, Type } from "../deps/typebox.ts";
import { joinPath, resolvePath } from "../deps/std_path.ts";
import { expandGlobSync } from "../deps/std_fs.ts";
import { createCliAction, ExitCode } from "../deps/cli_utils.ts";
import { cyan, gray } from "../deps/std_fmt_colors.ts";

const HelmLsResultSchema = Type.Array(Type.Object({
  name: Type.String(),
  namespace: Type.String(),
  revision: Type.String(),
  updated: Type.String(),
  status: Type.String(),
  chart: Type.String(),
  app_version: Type.String(),
}));

async function helmInstall(
  { name, namespace, chartPath, waitOnFirstInstall, waitOnSubsequentInstalls }:
    {
      name: string;
      namespace: string;
      chartPath: string;
      waitOnFirstInstall: boolean;
      waitOnSubsequentInstalls: boolean;
    },
) {
  const helmLsResultRaw = JSON.parse(
    await captureExec({
      run: {
        cmd: ["helm", "ls", "-a", "-n", namespace, "-o=json"],
      },
    }),
  );

  const helmLsResult = validate(HelmLsResultSchema, helmLsResultRaw);

  if (!helmLsResult.isSuccess) {
    throw new Error('Failed validating result of "helm ls" command');
  }

  const currentRelease = helmLsResult.value.find((i) => i.name === name);

  const helmUpgradeCmd = (currentRelease)
    ? [
      "helm",
      "upgrade",
      "--install",
      "-n",
      namespace,
      "--history-max=2",
      ...(waitOnSubsequentInstalls
        ? ["--atomic", "--cleanup-on-fail", "--timeout=10m"]
        : []),
      name,
      chartPath,
    ]
    : [
      "helm",
      "install",
      "-n",
      namespace,
      ...(waitOnFirstInstall ? ["--wait", "--timeout=10m"] : []),
      name,
      chartPath,
    ];

  console.log(`Executing:`, cyan(helmUpgradeCmd.join(" ")));

  const tag = gray(`[$ ${helmUpgradeCmd.slice(0, 2).join(" ")} ...]`);
  await inheritExec({
    run: { cmd: helmUpgradeCmd },
    stderrTag: tag,
    stdoutTag: tag,
  });
}

export const ParamsSchema = Type.Object({
  name: Type.String({
    description:
      "Helm release base name. This will be used as the prefx of the different sub-releases (*-crds, *-namespaces and *-resources)",
  }),
  namespace: Type.String({
    description: "The namespace where the Secrets for Helm releases are stored",
  }),
  source: Type.String({
    description:
      "Path to the compiled instance generated from `helmet compile ...`",
  }),
  wait: Type.Boolean({
    description:
      "Whether to pass --wait to the underlying `helm install ...` process",
    examples: [false],
  }),
});

export async function install(
  args: Static<typeof ParamsSchema>,
) {
  const { namespace } = args;
  const source = resolvePath(args.source);

  console.log(`Installing ${source}`);
  const crdsTemplatesPath = joinPath(source, "crds/templates");

  const hasCrds = Array
    .from(expandGlobSync("*.yaml", {
      root: crdsTemplatesPath,
    })).length > 0;

  if (hasCrds) {
    const kubectlApplyCmd = [
      "kubectl",
      "apply",
      "--server-side",
      "-f",
      crdsTemplatesPath,
    ];

    console.log("Executing:", cyan(kubectlApplyCmd.join(" ")));
    const tag = gray(`[$ ${kubectlApplyCmd.slice(0, 2).join(" ")} ...]`);
    await inheritExec({
      run: { cmd: kubectlApplyCmd },
      stderrTag: tag,
      stdoutTag: tag,
    });
  }

  await helmInstall({
    name: `${args.name}-namespaces`,
    namespace,
    chartPath: joinPath(source, "namespaces"),
    waitOnFirstInstall: true,
    waitOnSubsequentInstalls: true,
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
    name: `${args.name}-resources`,
    namespace,
    chartPath: joinPath(source, "resources"),
    waitOnFirstInstall: false,
    waitOnSubsequentInstalls: args.wait,
  });
}

export default createCliAction(ParamsSchema, async (args) => {
  await install(args);
  return ExitCode.Zero;
});
