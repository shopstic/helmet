import { Type } from "../deps/typebox.ts";
import { createCliAction, ExitCode } from "../deps/cli_utils.ts";
import {
  fetchCurrentWhitelist,
  updateWhitelist,
} from "./whitelist_instance.ts";
import { resolvePath } from "../deps/std_path.ts";
import { bold, red } from "../deps/std_fmt_colors.ts";
import { importBundleModule } from "../libs/iac_utils.ts";

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

    if (!whitelistedSet.has(releaseId)) {
      console.error(
        "Bundle instance",
        bold(red(releaseId)),
        "does not exist in the current whitelisted set of",
        whitelistedSet,
      );
      return ExitCode.One;
    }

    whitelistedSet.delete(releaseId);

    await updateWhitelist(whitelistedSet);

    return ExitCode.Zero;
  },
);
