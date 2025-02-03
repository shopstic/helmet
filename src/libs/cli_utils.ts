import { captureExec } from "@wok/utils/exec";
import { quoteShell } from "@wok/utils/quote-shell";

export async function calculateDirectoryDigest(dirPath: string): Promise<string> {
  return (await captureExec({
    cmd: ["bash"],
    stdin: {
      pipe: `tar -C ${
        quoteShell([dirPath])
      } --sort=name --mtime='1970-01-01' --owner=0 --group=0 --numeric-owner -cf - . | md5sum`,
    },
  })).out.split(" ", 1)[0];
}

export async function getCurrentKubeContext(): Promise<string> {
  return (await captureExec({
    cmd: ["kubectl", "config", "current-context"],
  })).out.trim();
}
