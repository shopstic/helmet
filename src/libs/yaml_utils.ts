import { stringify as stringifyYaml } from "@std/yaml";
import { captureExec } from "@wok/utils/exec";

export function stringifyYamlRelaxed(value: Record<string, unknown>): string {
  return stringifyYaml(value, {
    skipInvalid: true,
  });
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
