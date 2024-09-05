import { stringify as stringifyYaml } from "@std/yaml";
import { captureExec } from "@wok/utils/exec";

export function stringifyYamlRelaxed(value: Record<string, unknown>): string {
  try {
    return stringifyYaml(value);
  } catch (cause) {
    if (cause instanceof TypeError) {
      try {
        return stringifyYaml(JSON.parse(JSON.stringify(value)));
      } catch {
        // Throw with the original cause
        throw new Error("Failed to stringify YAML", { cause });
      }
    } else {
      throw cause;
    }
  }
}

export async function parseMultiDocumentsYaml(
  rawYaml: string,
): Promise<Record<string, unknown>[]> {
  const raw = await captureExec({
    cmd: [
      "yq",
      "ea",
      "-o=json",
      "-N",
      ". as $doc ireduce ([]; . + $doc)",
      "-",
    ],
    stdin: {
      pipe: rawYaml,
    },
  }).catch((e) => {
    console.error(rawYaml);
    return Promise.reject(
      new Error(
        `Failed parsing YAML to JSON: ${e.toString()}`,
      ),
    );
  });

  return JSON.parse(raw.out);
}
