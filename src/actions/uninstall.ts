import { createCliAction, ExitCode } from "../deps/cli_utils.ts";
import { inheritExec } from "../deps/exec_utils.ts";
import { Type } from "../deps/typebox.ts";

export default createCliAction(
  Type.Object({
    name: Type.String({
      description: "Instance name to uninstall",
      examples: ["iac-my-stack"],
    }),
  }),
  async (args) => {
    await inheritExec({
      run: { cmd: ["helm", "uninstall", `${args.name}-resources`] },
    });

    await inheritExec({
      run: { cmd: ["helm", "uninstall", `${args.name}-namespaces`] },
    });

    return ExitCode.Zero;
  },
);
