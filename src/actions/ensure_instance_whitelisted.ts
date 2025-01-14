import { createCliAction, ExitCode } from "@wok/utils/cli";
import { captureExec } from "@wok/utils/exec";
import { bold, cyan, red } from "@std/fmt/colors";
import { resolve as resolvePath } from "@std/path";
import { importBundleModule } from "../libs/iac_utils.ts";
import { fetchCurrentWhitelist } from "./whitelist_instance.ts";
import { Str } from "../deps/schema.ts";

export default createCliAction(
  {
    path: Str({
      description: "Path to the instance module",
      examples: ["./instances/prod.ts"],
    }),
  },
  async ({ path }) => {
    const source = resolvePath(path);

    const bundleModule = await importBundleModule(source);
    const { releaseId, releaseNamespace } = bundleModule;
    const whitelistedSet = await fetchCurrentWhitelist();

    if (!whitelistedSet.has(releaseId)) {
      const currentKubeContext = (await captureExec({
        cmd: ["kubectl", "config", "current-context"],
      })).out;
      console.error(
        "Bundle instance",
        bold(red(releaseId)),
        "is not whitelisted",
      );
      console.error(
        "Current Kubernetes context is",
        cyan(currentKubeContext.trim()),
      );
      console.error(
        `The current whitelisted set is`,
        whitelistedSet,
      );
      return ExitCode.One;
    }

    console.log(
      JSON.stringify({
        releaseId,
        releaseNamespace,
      }),
    );
    return ExitCode.Zero;
  },
);
