import { createCliAction, ExitCode } from "../deps/cli_utils.ts";

export default createCliAction(
  {},
  () => {
    console.log(JSON.stringify(
      {
        app: Deno.env.get("HELMET_VERSION") ?? "dev",
        ...Deno.version,
      },
      null,
      2,
    ));
    return Promise.resolve(ExitCode.Zero);
  },
);
