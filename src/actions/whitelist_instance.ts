import { inheritExec, printErrLines, printOutLines } from "../deps/exec_utils.ts";
import { createK8sConfigMap } from "../deps/k8s_utils.ts";
import { createCliAction, ExitCode } from "../deps/cli_utils.ts";
import { Type } from "../deps/typebox.ts";
import { resolvePath } from "../deps/std_path.ts";
import { gray } from "../deps/std_fmt_colors.ts";
import { importBundleModule } from "../libs/iac_utils.ts";

export const CONFIG_MAP_NAME = "helmet-whitelist";
export const CONFIG_MAP_NAMESPACE = "default";

export async function fetchCurrentWhitelist(): Promise<Set<string>> {
  const output = await new Deno.Command("kubectl", {
    args: [
      "get",
      `configmap/${CONFIG_MAP_NAME}`,
      "-n",
      CONFIG_MAP_NAMESPACE,
      "-o=jsonpath={.data}",
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();

  if (output.code !== 0) {
    const stderr = new TextDecoder().decode(output.stderr);
    if (stderr.indexOf("not found") === -1) {
      throw new Error(stderr);
    }
    return new Set<string>();
  }

  const stdout = new TextDecoder().decode(output.stdout);

  if (stdout.length === 0) {
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
      Array.from(instances).map((name) => [name, "yes"]),
    ),
  });

  const tag = gray(`[$ kubectl apply ...]`);

  await inheritExec({
    cmd: ["kubectl", "apply", "-f", "-"],
    stdin: {
      pipe: JSON.stringify(newConfigMap),
    },
    stderr: {
      read: printErrLines((line) => `${tag} ${line}`),
    },
    stdout: {
      read: printOutLines((line) => `${tag} ${line}`),
    },
  });
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

    const bundleModule = await importBundleModule(source);
    const { releaseId } = bundleModule;
    const whitelistedSet = await fetchCurrentWhitelist();

    whitelistedSet.add(releaseId);

    await updateWhitelist(whitelistedSet);

    return ExitCode.Zero;
  },
);
