import { createCliAction, ExitCode } from "@wok/utils/cli";
import { inheritExec } from "@wok/utils/exec";
import { Type } from "@wok/typebox";

export default createCliAction(
  {
    name: Type.String({
      description: "Instance name to uninstall",
      examples: ["iac-my-stack"],
    }),
    namespace: Type.String({
      description: "The namespace where corresponding Helm releases of this instance were installed to",
      examples: ["iac-my-stack"],
    }),
  },
  async ({ name, namespace }) => {
    await inheritExec({
      cmd: ["helm", "uninstall", "-n", namespace, `${name}-resources`],
    });

    await inheritExec({
      cmd: ["helm", "uninstall", "-n", namespace, `${name}-namespaces`],
    });

    return ExitCode.Zero;
  },
);
