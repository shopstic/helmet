import { Type } from "@wok/typebox";
import { createCliAction, ExitCode } from "@wok/utils/cli";
import { fetchCurrentWhitelist, updateWhitelist } from "./whitelist_instance.ts";
import { resolve as resolvePath } from "@std/path";
import { bold, red } from "@std/fmt/colors";
import { importBundleModule } from "../libs/iac_utils.ts";

export default createCliAction(
  {
    path: Type.String({
      description: "Path to the instance module",
      examples: ["./instances/prod.ts"],
    }),
  },
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
