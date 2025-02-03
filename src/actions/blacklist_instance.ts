import { createCliAction, ExitCode } from "@wok/utils/cli";
import { fetchCurrentWhitelist, updateWhitelist } from "./whitelist_instance.ts";
import { resolve as resolvePath } from "@std/path";
import { importBundleModule } from "../libs/iac_utils.ts";
import { Arr, Str } from "../deps/schema.ts";

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
      whitelist.set.delete(releaseId);
    }));

    await updateWhitelist(whitelist);

    return ExitCode.Zero;
  },
);
