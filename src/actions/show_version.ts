import { createCliAction, ExitCode } from "@wok/utils/cli";

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
