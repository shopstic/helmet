import { createCliAction, ExitCode } from "../deps/cli_utils.ts";
import { Type } from "../deps/typebox.ts";

export default createCliAction(
  Type.Object({}),
  () => {
    console.log({
      app: Deno.env.get("HELMET_VERSION") ?? "dev",
      ...Deno.version,
    });
    return Promise.resolve(ExitCode.Zero);
  },
);
