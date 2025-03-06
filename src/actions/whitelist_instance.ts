import { inheritExec, printErrLines, printOutLines } from "@wok/utils/exec";
import { createK8sConfigMap, type K8sConfigMap } from "@wok/k8s-utils";
import { createCliAction, ExitCode } from "@wok/utils/cli";
import { resolve as resolvePath } from "@std/path";
import { gray } from "@std/fmt/colors";
import { importBundleModule } from "../libs/iac_utils.ts";
import { Arr, Str } from "../deps/schema.ts";

export const CONFIG_MAP_NAME = "run.helmet.whitelist.v1";
export const CONFIG_MAP_NAMESPACE = "default";

export interface HelmetWhitelist {
  set: Set<string>;
  resourceVersion?: string;
}

export async function fetchCurrentWhitelist(): Promise<HelmetWhitelist> {
  const output = await new Deno.Command("kubectl", {
    args: [
      "get",
      `configmap/${CONFIG_MAP_NAME}`,
      "-n",
      CONFIG_MAP_NAMESPACE,
      "-o=json",
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();

  if (output.code !== 0) {
    const stderr = new TextDecoder().decode(output.stderr);
    if (stderr.indexOf("not found") === -1) {
      throw new Error(stderr);
    }
    return { set: new Set<string>() };
  }

  const stdout = new TextDecoder().decode(output.stdout);

  if (stdout.length === 0) {
    return { set: new Set<string>() };
  }

  const configMap: K8sConfigMap = JSON.parse(stdout);

  return {
    set: new Set(Object.entries(configMap.data ?? {}).filter(([_, v]) => v === "yes").map(([k]) => k)),
    resourceVersion: configMap.metadata.resourceVersion,
  };
}

export async function updateWhitelist(whitelist: HelmetWhitelist): Promise<void> {
  const newConfigMap = createK8sConfigMap({
    metadata: {
      name: CONFIG_MAP_NAME,
      namespace: CONFIG_MAP_NAMESPACE,
      resourceVersion: whitelist.resourceVersion,
    },
    data: Object.fromEntries(
      Array.from(whitelist.set).map((name) => [name, "yes"]),
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
  {
    _: Arr(Str(), {
      description: "Paths to the instance modules",
      examples: [["./instances/one.ts"], ["./instances/two.ts"]],
      title: "paths",
      minItems: 1,
    }),
  },
  async ({ _: paths }) => {
    const whitelist = await fetchCurrentWhitelist();

    await Promise.all(paths.map(async (path) => {
      const source = resolvePath(path);
      const bundleModule = await importBundleModule(source);
      const { releaseId } = bundleModule;
      whitelist.set.add(releaseId);
    }));

    await updateWhitelist(whitelist);

    return ExitCode.Zero;
  },
);
