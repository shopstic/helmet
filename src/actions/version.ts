import { createCliAction, ExitCode } from "@wok/utils/cli";
import { default as config } from "../../deno.json" with { type: "json" };

export default createCliAction(
  {},
  () => {
    console.log(JSON.stringify(
      {
        app: config.version === "*" ? "dev" : config.version,
        ...Deno.version,
      },
      null,
      2,
    ));
    return Promise.resolve(ExitCode.Zero);
  },
);
