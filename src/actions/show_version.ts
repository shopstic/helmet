import { createCliAction, ExitCode } from "../deps/cli_utils.ts";
import { Type } from "../deps/typebox.ts";
import version from "../version.ts";

export default createCliAction(
  Type.Object({}),
  () => {
    console.log({
      app: version,
      ...Deno.version,
    });
    return Promise.resolve(ExitCode.Zero);
  },
);
