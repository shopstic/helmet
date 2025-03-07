import { parseAll, stringify } from "@std/yaml";

export function stringifyYamlRelaxed(value: unknown): string {
  return stringify(value, {
    skipInvalid: true,
  });
}

export function parseMultiDocumentsYaml(rawYaml: string): unknown[] {
  return parseAll(rawYaml, { allowDuplicateKeys: true }) as unknown[];
}
