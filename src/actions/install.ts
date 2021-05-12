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
  { name, namespace, chartPath, wait, cleanupOnFail, atomic, timeout, force }: {
    name: string;
    namespace: string;
    chartPath: string;
    wait: boolean;
    cleanupOnFail: boolean;
    atomic: boolean;
    timeout?: string;
    force: boolean;
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
      "-n",
      namespace,
      "--history-max=2",
      ...(wait ? ["--wait"] : []),
      ...(cleanupOnFail ? ["--cleanup-on-fail"] : []),
      ...(atomic ? ["--atomic"] : []),
      ...(timeout ? [`--timeout=${timeout}`] : []),
      ...(force ? ["--force"] : []),
      name,
      chartPath,
    ]
    : [
      "helm",
      "install",
      "-n",
      namespace,
      ...(wait ? ["--wait"] : []),
      ...(atomic ? ["--atomic"] : []),
      ...(timeout ? [`--timeout=${timeout}`] : []),
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
  wait: Type.Optional(Type.Boolean({
    description:
      "Whether to pass --wait to the underlying `helm upgrade ...` process",
    default: false,
    examples: [false],
  })),
  atomic: Type.Optional(Type.Boolean({
    description:
      "Whether to pass --atomic to the underlying `helm upgrade ...` process",
    default: false,
    examples: [false],
  })),
  cleanupOnFail: Type.Optional(Type.Boolean({
    description:
      "Whether to pass --cleanup-on-fail to the underlying `helm upgrade ...` process",
    default: false,
    examples: [false],
  })),
  force: Type.Optional(Type.Boolean({
    description:
      "Whether to pass --force to the underlying `helm upgrade ...` process",
    default: false,
    examples: [false],
  })),
  timeout: Type.Optional(Type.String({
    description: "Pass --timeout to the underlying `helm upgrade ...` process",
    default: "",
    examples: ["5m0s"],
  })),
});

export async function install(
  {
    name,
    namespace,
    source,
    wait = false,
    atomic = false,
    cleanupOnFail = false,
    force = false,
    timeout,
  }: Static<typeof ParamsSchema>,
) {
  const resolvedSource = resolvePath(source);

  console.log(`Installing ${resolvedSource}`);
  const crdsTemplatesPath = joinPath(resolvedSource, "crds/templates");

  const hasCrds = Array
    .from(expandGlobSync("*.yaml", {
      root: crdsTemplatesPath,
    })).length > 0;

  if (hasCrds) {
    const kubectlApplyCmd = [
      "kubectl",
      "apply",
      "--server-side",
      "--force-conflicts",
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
    name: `${name}-namespaces`,
    namespace,
    chartPath: joinPath(resolvedSource, "namespaces"),
    wait,
    atomic,
    cleanupOnFail,
    force,
    timeout,
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
  });
}

export default createCliAction(ParamsSchema, async (args) => {
  await install(args);
  return ExitCode.Zero;
});
