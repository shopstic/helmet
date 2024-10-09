import compile from "./actions/compile.ts";
import install from "./actions/install.ts";
import uninstall from "./actions/uninstall.ts";
import typeify from "./actions/typeify.ts";
import update from "./actions/update.ts";
import whitelistInstance from "./actions/whitelist_instance.ts";
import blacklistInstance from "./actions/blacklist_instance.ts";
import ensureInstanceWhitelisted from "./actions/ensure_instance_whitelisted.ts";
import { CliProgram } from "@wok/utils/cli";
import version from "./actions/version.ts";
import { bold, red } from "@std/fmt/colors";

const program = new CliProgram()
  .addAction("compile", compile)
  .addAction("install", install)
  .addAction("uninstall", uninstall)
  .addAction("typeify", typeify)
  .addAction("update", update)
  .addAction("whitelist", whitelistInstance)
  .addAction("blacklist", blacklistInstance)
  .addAction("ensure-whitelisted", ensureInstanceWhitelisted)
  .addAction("version", version);

try {
  await program.run(Deno.args);
} catch (e) {
  console.error(bold(red("[Error]")), e);

  if (Deno.env.get("HELMET_ENABLE_STACKTRACE") !== "0") {
    throw e;
  } else {
    Deno.exit(1);
  }
}

// Bump
