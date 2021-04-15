import compile from "./actions/compile.ts";
import install from "./actions/install.ts";
import uninstall from "./actions/uninstall.ts";
import typeify from "./actions/typeify.ts";
import update from "./actions/update.ts";
import whitelistInstance from "./actions/whitelist-instance.ts";
import blacklistInstance from "./actions/blacklist-instance.ts";
import ensureInstanceWhitelisted from "./actions/ensure-instance-whitelisted.ts";
import { CliProgram } from "./deps/cli-utils.ts";
import showVersion from "./actions/show-version.ts";

const program = new CliProgram()
  .addAction("compile", compile)
  .addAction("install", install)
  .addAction("uninstall", uninstall)
  .addAction("typeify", typeify)
  .addAction("update", update)
  .addAction("whitelist", whitelistInstance)
  .addAction("blacklist", blacklistInstance)
  .addAction("ensure-whitelisted", ensureInstanceWhitelisted)
  .addAction("version", showVersion);

try {
  await program.run(Deno.args);
} catch (e) {
  if (Deno.env.get("HELMET_ENABLE_STACKTRACE") === "1") {
    throw e;
  } else {
    console.error("[Error]", e.message);
    Deno.exit(1);
  }
}
