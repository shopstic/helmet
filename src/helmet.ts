import compile from "./actions/compile.ts";
import install from "./actions/install.ts";
import uninstall from "./actions/uninstall.ts";
import typeify from "./actions/typeify.ts";
import update from "./actions/update.ts";
import whitelistInstance from "./actions/whitelist_instance.ts";
import blacklistInstance from "./actions/blacklist_instance.ts";
import ensureInstanceWhitelisted from "./actions/ensure_instance_whitelisted.ts";
import { CliProgram } from "./deps/cli_utils.ts";
import showVersion from "./actions/show_version.ts";
import { bold, red } from "./deps/std_fmt_colors.ts";

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
  console.error(bold(red("[Error]")), JSON.stringify(e, null, 2));

  if (Deno.env.get("HELMET_ENABLE_STACKTRACE") !== "0") {
    throw e;
  } else {
    Deno.exit(1);
  }
}
