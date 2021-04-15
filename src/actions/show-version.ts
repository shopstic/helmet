import { createCliAction, ExitCode } from "../deps/cli-utils.ts";
import { Type } from "../deps/typebox.ts";
import version from "../version.ts";

export default createCliAction(
  Type.Object({}),
  () => {
    console.log(version);
    return Promise.resolve(ExitCode.One);
  },
);
