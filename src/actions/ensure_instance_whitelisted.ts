import { createCliAction, ExitCode } from "../deps/cli_utils.ts";
import { captureExec } from "../deps/exec_utils.ts";
import { bold, cyan, red } from "../deps/std_fmt_colors.ts";
import { resolvePath } from "../deps/std_path.ts";
import { Type } from "../deps/typebox.ts";
import { importBundleModule } from "../libs/iac_utils.ts";
import { fetchCurrentWhitelist } from "./whitelist_instance.ts";

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
    const { releaseId, releaseNamespace } = bundleModule;
    const whitelistedSet = await fetchCurrentWhitelist();

    if (!whitelistedSet.has(releaseId)) {
      const currentKubeContext = await captureExec({
        run: {
          cmd: ["kubectl", "config", "current-context"],
        },
      });
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
