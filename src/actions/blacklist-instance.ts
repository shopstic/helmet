import { Type } from "../deps/typebox.ts";
import { createCliAction, ExitCode } from "../deps/cli-utils.ts";
import {
  fetchCurrentWhitelist,
  loadInstanceId,
  updateWhitelist,
} from "./whitelist-instance.ts";
import { resolvePath } from "../deps/std-path.ts";
import { bold, red } from "../deps/std-fmt-colors.ts";

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
      console.error(
        "Bundle instance",
        bold(red(instanceId)),
        "does not exist in the current whitelisted set of",
        whitelistedSet,
      );
      return ExitCode.One;
    }

    whitelistedSet.delete(instanceId);

    await updateWhitelist(whitelistedSet);

    return ExitCode.Zero;
  },
);
