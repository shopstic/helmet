import { createCliAction, ExitCode } from "@wok/utils/cli";
import { inheritExec } from "@wok/utils/exec";
import { Arr, Bool, Opt, Str } from "../deps/schema.ts";
import { resolvePath } from "../deps/std_path.ts";
import { importBundleModule } from "../libs/iac_utils.ts";
import { bold, cyan, green, red, yellow } from "@std/fmt/colors";
import { fetchCurrentWhitelist } from "./whitelist_instance.ts";
import { getCurrentKubeContext } from "../libs/cli_utils.ts";
import { getDefaultLogger } from "@wok/utils/logger";

export default createCliAction(
  {
    noConfirm: Opt(
      Bool({
        description: "Whether to skip the confirmation prompt",
      }),
      false,
    ),
    _: Arr(Str(), {
      description: "Paths to the instance modules",
      examples: [["./instances/one.ts"], ["./instances/two.ts"]],
      title: "paths",
      minItems: 1,
    }),
  },
  async ({ _: paths, noConfirm }) => {
    const logger = getDefaultLogger();
    const bundles = await Promise.all(paths.map((path) => importBundleModule(resolvePath(path))));
    const whitelist = await fetchCurrentWhitelist();

    for (const bundle of bundles) {
      if (!whitelist.set.has(bundle.releaseId)) {
        const currentKubeContext = await getCurrentKubeContext();
        logger.error?.("Bundle instance", bold(yellow(name)), "is not whitelisted");
        logger.error?.("Current Kubernetes context is", cyan(currentKubeContext.trim()));
        logger.error?.("The current whitelisted set is", whitelist.set);
        return ExitCode.One;
      }
    }

    if (!noConfirm) {
      const answer = prompt(
        `Are you sure you want to uninstall the following instances?\n` +
          bundles.map((b) => ` - ${bold(yellow(b.releaseId))}`).join("\n") +
          `\nAnswer (${green("y")}/${red("n")}):`,
      );

      if (!answer || answer.toLowerCase() !== "y") {
        return ExitCode.One;
      }
    }

    for (const bundle of bundles) {
      await inheritExec({
        cmd: ["helm", "uninstall", "-n", bundle.releaseNamespace, `${bundle.releaseId}-resources`],
      });
      await inheritExec({
        cmd: ["helm", "uninstall", "-n", bundle.releaseNamespace, `${bundle.releaseId}-namespaces`],
      });
    }

    return ExitCode.Zero;
  },
);
