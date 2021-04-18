import { createCliAction, ExitCode } from "../deps/cli_utils.ts";
import { captureExec } from "../deps/exec_utils.ts";
import { bold, cyan, red } from "../deps/std_fmt_colors.ts";
import { resolvePath } from "../deps/std_path.ts";
import { Type } from "../deps/typebox.ts";
import { fetchCurrentWhitelist, loadInstanceId } from "./whitelist_instance.ts";

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

    if (!whitelistedSet.has(instanceId)) {
      const currentKubeContext = await captureExec({
        run: {
          cmd: ["kubectl", "config", "current-context"],
        },
      });
      console.error(
        "Bundle instance",
        bold(red(instanceId)),
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

    console.log(instanceId);
    return ExitCode.Zero;
  },
);
