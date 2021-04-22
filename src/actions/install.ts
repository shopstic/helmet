import { captureExec, inheritExec } from "../deps/exec_utils.ts";
import { validate } from "../deps/validation_utils.ts";
import { Type } from "../deps/typebox.ts";
import { joinPath, resolvePath } from "../deps/std_path.ts";
// TODO: Temporary workaround until this ends up in the next deno release https://github.com/denoland/deno/issues/10174
export { joinGlobs } from "https://deno.land/std@0.93.0/path/glob.ts";
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
  { name, chartPath, waitOnFirstInstall, waitOnSubsequentInstalls }: {
    name: string;
    chartPath: string;
    waitOnFirstInstall: boolean;
    waitOnSubsequentInstalls: boolean;
  },
) {
  const helmLsResultRaw = JSON.parse(
    await captureExec({
      run: {
        cmd: ["helm", "ls", "-a", "-o=json"],
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
      "--history-max=5",
      ...(waitOnSubsequentInstalls
        ? ["--atomic", "--cleanup-on-fail", "--timeout=10m"]
        : []),
      name,
      chartPath,
    ]
    : [
      "helm",
      "install",
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

export async function install(
  args: { name: string; source: string; wait: boolean },
) {
  const source = resolvePath(args.source);

  console.log(`Installing ${source}`);
  const crdsTemplatesPath = joinPath(source, "crds/templates");

  const hasCrds = Array
    .from(expandGlobSync("*.yaml", {
      root: crdsTemplatesPath,
    })).length > 0;

  if (hasCrds) {
    const kubectlApplyCmd = ["kubectl", "apply", "-f", crdsTemplatesPath];

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
    chartPath: joinPath(source, "resources"),
    waitOnFirstInstall: false,
    waitOnSubsequentInstalls: args.wait,
  });
}

export default createCliAction(
  Type.Object({
    name: Type.String(),
    source: Type.String(),
    wait: Type.Boolean(),
  }),
  async (args) => {
    await install(args);
    return ExitCode.Zero;
  },
);
