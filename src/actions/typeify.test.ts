import { assert } from "@std/assert/assert";
import { propToTypeMap } from "./typeify.ts";

Deno.test("propToTypeMap", () => {
  assert(propToTypeMap.tolerations.expectation([{
    operator: "Equal",
    effect: "NoSchedule",
  }]));
});
