import { stringifyYaml, YAMLError } from "../deps/std-yaml.ts";
import { captureExec } from "../deps/exec-utils.ts";

export function stringifyYamlRelaxed(value: Record<string, unknown>): string {
  try {
    return stringifyYaml(value);
  } catch (e) {
    if (
      e instanceof YAMLError &&
      e.message.indexOf("unacceptable kind of an object to dump") !== -1
    ) {
      return stringifyYaml(JSON.parse(JSON.stringify(value)));
    } else {
      throw e;
    }
  }
}

export async function parseMultiDocumentsYaml(
  rawYaml: string,
): Promise<Record<string, unknown>[]> {
  const rawJson = await captureExec({
    run: {
      cmd: [
        "yq",
        "ea",
        "-j",
        "-N",
        ". as $doc ireduce ([]; . + $doc)",
        "-",
      ],
    },
    stdin: rawYaml,
  }).catch((e) => {
    console.error(rawYaml);
    return Promise.reject(
      new Error(
        `Failed parsing YAML to JSON: ${e.toString()}`,
      ),
    );
  });

  return JSON.parse(rawJson);
}
