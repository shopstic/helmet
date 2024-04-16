import { createCliAction, ExitCode } from "../deps/cli_utils.ts";
import { Type } from "../deps/typebox.ts";
import denoJson from "../../deno.json" with { type: "json" };

export default createCliAction(
  Type.Object({}),
  () => {
    console.log({
      app: denoJson.version,
      ...Deno.version,
    });
    return Promise.resolve(ExitCode.Zero);
  },
);
