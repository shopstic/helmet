import { assertEquals } from "@std/assert";
import { stringifyYamlRelaxed } from "./yaml_utils.ts";

Deno.test("stringifyYamlRelaxed", () => {
  assertEquals(
    stringifyYamlRelaxed({
      foo: undefined,
      bar: 123,
    }),
    "bar: 123\n",
  );
});
