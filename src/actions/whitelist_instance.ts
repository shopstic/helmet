import { inheritExec } from "../deps/exec_utils.ts";
import { createK8sConfigMap } from "../deps/k8s_utils.ts";
import { createCliAction, ExitCode } from "../deps/cli_utils.ts";
import { Type } from "../deps/typebox.ts";
import { resolvePath } from "../deps/std_path.ts";
import { gray } from "../deps/std_fmt_colors.ts";

export const CONFIG_MAP_NAME = "helmet-whitelist";
export const CONFIG_MAP_NAMESPACE = "default";

export async function fetchCurrentWhitelist(): Promise<Set<string>> {
  const child = Deno.run({
    cmd: [
      "kubectl",
      "get",
      `configmap/${CONFIG_MAP_NAME}`,
      "-n",
      CONFIG_MAP_NAMESPACE,
      "-o=jsonpath={.data}",
    ],
    stdout: "piped",
    stderr: "piped",
  });

  const stdout = new TextDecoder().decode(await child.output());
  const stderr = new TextDecoder().decode(await child.stderrOutput());
  const { code } = await child.status();

  if (
    stdout.length === 0 ||
    (code !== 0 && stderr.indexOf("not found") !== -1)
  ) {
    return new Set<string>();
  }

  const data: Record<string, string> = JSON.parse(stdout);

  return new Set(Object.keys(data).filter((k) => data[k] === "yes"));
}

export async function updateWhitelist(
  instances: Set<string>,
): Promise<void> {
  const newConfigMap = createK8sConfigMap({
    metadata: {
      name: CONFIG_MAP_NAME,
      namespace: CONFIG_MAP_NAMESPACE,
    },
    data: Object.fromEntries(
      Array.from(instances).map((name) => ([name, "yes"])),
    ),
  });

  await inheritExec({
    run: {
      cmd: ["kubectl", "apply", "-f", "-"],
    },
    stdin: JSON.stringify(newConfigMap),
    stdoutTag: gray(`[$ kubectl apply ...]`),
    stderrTag: gray(`[$ kubectl apply ...]`),
  });
}

export async function loadInstanceId(path: string): Promise<string> {
  const chartModule = await import(path);

  if (!chartModule.id) {
    throw new Error(
      `Instance module does not export an 'id' const, please check: ${path}`,
    );
  }

  return chartModule.id as string;
}

export default createCliAction(
  Type.Object({
    path: Type.String({
      description: "Path to the instance module",
      examples: ["./instances/prod.ts"],
    }),
  }),
  async ({ path }) => {
    const source = resolvePath(path);

    const instanceId = await loadInstanceId(source);
    const whitelistedSet = await fetchCurrentWhitelist();

    whitelistedSet.add(instanceId);

    await updateWhitelist(whitelistedSet);

    return ExitCode.Zero;
  },
);
