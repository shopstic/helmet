import { createCliAction, ExitCode } from "../deps/cli_utils.ts";
import { inheritExec } from "../deps/exec_utils.ts";
import { Type } from "../deps/typebox.ts";

export default createCliAction(
  Type.Object({
    name: Type.String({
      description: "Instance name to uninstall",
      examples: ["iac-my-stack"],
    }),
    namespace: Type.String({
      description:
        "The namespace where corresponding Helm releases of this instance were installed to",
      examples: ["iac-my-stack"],
    }),
  }),
  async ({ name, namespace }) => {
    await inheritExec({
      run: { cmd: ["helm", "uninstall", "-n", namespace, `${name}-resources`] },
    });

    await inheritExec({
      run: {
        cmd: ["helm", "uninstall", "-n", namespace, `${name}-namespaces`],
      },
    });

    return ExitCode.Zero;
  },
);
