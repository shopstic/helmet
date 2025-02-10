import { deepMerge } from "../libs/patch_utils.ts";

import { checkAndImport, type ImportDef, readChartCrds, type TypeifyPatch } from "../libs/iac_utils.ts";
import { basename, join as joinPath, resolve as resolvePath } from "@std/path";
import { exists as fsExists } from "@std/fs";
import { parse as parseYaml } from "@std/yaml";
import { pascalCase } from "@wok/case";
import { inheritExec, printErrLines } from "@wok/utils/exec";
import { K8sCrdApiVersionV1beta1 } from "@wok/utils/k8s";
import { createCliAction, ExitCode } from "@wok/utils/cli";
import { cyan, gray } from "@std/fmt/colors";
import { Arr, Str } from "../deps/schema.ts";
import { compile as jsonSchemaToTs } from "json-schema-to-typescript";
import { getDefaultLogger, type Logger } from "@wok/utils/logger";
import { K8sKnownTypeKeySets } from "@wok/k8s/known-type-key-sets";

export type ClassifiedType =
  | "array"
  | "string"
  | "object"
  | "number"
  | "boolean"
  | "symbol"
  | "unknown";

export type Expectation = (value: unknown) => boolean;

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

export function isString(value: unknown): value is string {
  return typeof value === "string";
}

export function classifyType(value: unknown): ClassifiedType {
  const typ = typeof value;

  if (typ === "object" && value !== null) {
    if (Array.isArray(value)) {
      return "array";
    } else {
      return "object";
    }
  } else if (typ === "string") {
    return "string";
  } else if (typ === "number") {
    return "number";
  } else if (typ === "boolean") {
    return "boolean";
  } else if (typ === "symbol") {
    return "symbol";
  } else {
    return "unknown";
  }
}

interface TypeDef {
  expectation: Expectation;
  type: string;
  imports: ImportDef[];
}

const imports = [
  {
    props: ["K8s"],
    from: "@wok/helmet",
  },
];

function inferObjectType<T extends keyof typeof K8sKnownTypeKeySets>(typeName: T): TypeDef {
  return {
    expectation: (value) =>
      value === null || (isObject(value) &&
        Object.keys(value).every((key) => K8sKnownTypeKeySets[typeName].has(key))),
    type: `K8s[${JSON.stringify(typeName)}]`,
    imports,
  } satisfies TypeDef;
}

function inferArrayType<T extends keyof typeof K8sKnownTypeKeySets>(typeName: T): TypeDef {
  return {
    expectation: (value) =>
      value === null ||
      (isArray(value) && value.every((v) => {
        return isObject(v) && Object.keys(v).every((key) => K8sKnownTypeKeySets[typeName].has(key));
      })),
    type: `Array<K8s[${JSON.stringify(typeName)}]>`,
    imports,
  } satisfies TypeDef;
}

function inferRecordType() {
  return {
    expectation: (value) =>
      value === null ||
      (isObject(value) && Object.entries(value).every(([key, value]) => isString(key) && isString(value))),
    type: `Record<string, string>`,
    imports: [],
  } satisfies TypeDef;
}

const pullPolicyTypeName = "K8sImagePullPolicy" as const;
const knownPullPolicies = new Set(["Always", "IfNotPresent", "Never"]);
export const pullPolicyType: TypeDef = {
  expectation: (value) => isString(value) && knownPullPolicies.has(value),
  type: pullPolicyTypeName,
  imports: [
    {
      props: ["K8sImagePullPolicy"],
      from: "@wok/helmet",
    },
  ],
};

export const propToTypeMap = {
  imagePullSecrets: inferArrayType("core.v1.LocalObjectReference"),
  pullPolicy: pullPolicyType,
  imagePullPolicy: pullPolicyType,
  labels: inferRecordType(),
  podLabels: inferRecordType(),
  extraLabels: inferRecordType(),
  annotations: inferRecordType(),
  podAnnotations: inferRecordType(),
  podSecurityContext: inferObjectType("core.v1.PodSecurityContext"),
  securityContext: inferObjectType("core.v1.SecurityContext"),
  containerSecurityContext: inferObjectType("core.v1.SecurityContext"),
  nodeSelector: inferRecordType(),
  tolerations: inferArrayType("core.v1.Toleration"),
  affinity: inferObjectType("core.v1.Affinity"),
  resources: inferObjectType("core.v1.ResourceRequirements"),
  env: inferArrayType("core.v1.EnvVar"),
  livenessProbe: inferObjectType("core.v1.Probe"),
  readinessProbe: inferObjectType("core.v1.Probe"),
  volumes: inferArrayType("core.v1.Volume"),
  extraVolumes: inferArrayType("core.v1.Volume"),
  volumeMounts: inferArrayType("core.v1.VolumeMount"),
  extraVolumeMounts: inferArrayType("core.v1.VolumeMount"),
  extraHostVolumeMounts: inferArrayType("core.v1.VolumeMount"),
  dnsConfig: inferObjectType("core.v1.PodDNSConfig"),
  extraContainers: inferArrayType("core.v1.Container"),
  podDisruptionBudget: inferObjectType("policy.v1.PodDisruptionBudgetSpec"),
};

type KnownKey = keyof typeof propToTypeMap;

interface GeneratedType {
  output: string;
  imports: ImportDef[];
}

function toCommentBlock(value: unknown) {
  return `/* ${
    JSON.stringify(value).replaceAll("/*", "\\/*").replaceAll(
      "*/",
      "*\\/",
    )
  } */`;
}

function generateTypeForKnownKey(key: KnownKey, value: unknown): GeneratedType {
  const def = propToTypeMap[key];

  if (def.expectation(value)) {
    return {
      output: `${def.type} ${toCommentBlock(value)}`,
      imports: def.imports,
    };
  } else {
    return generateTypeForUnknownKey(value);
  }
}

function generateTypeForUnknownKey(value: unknown): GeneratedType {
  const typ = classifyType(value);

  switch (typ) {
    case "number":
    case "string":
    case "boolean":
      return {
        output: `${typ} ${toCommentBlock(value)}`,
        imports: [],
      };
    case "array": {
      const arrayValue = value as unknown[];

      if (arrayValue.length === 1) {
        const param = generateTypeForUnknownKey(arrayValue[0]);

        return {
          output: `Array<${param.output}>`,
          imports: param.imports,
        };
      } else if (
        arrayValue.length > 1 && arrayValue.every((v) => typeof v === "string")
      ) {
        return {
          output: `string[] ${toCommentBlock(arrayValue)}`,
          imports: [],
        };
      } else if (
        arrayValue.length > 1 && arrayValue.every((v) => typeof v === "number")
      ) {
        return {
          output: `number[] ${toCommentBlock(arrayValue)}`,
          imports: [],
        };
      } else {
        return {
          output: `any[] ${toCommentBlock(arrayValue)}`,
          imports: [],
        };
      }
    }
    case "symbol": {
      const symbolValue = value as symbol;
      return {
        output: `${symbolValue.description} /* charts patch */`,
        imports: [],
      };
    }
    case "unknown":
      return {
        output: `any ${toCommentBlock(value)}`,
        imports: [],
      };
    case "object":
      return generateTypeForObject(value as Record<string, unknown>);
  }
}

function generateTypeForObject(obj: Record<string, unknown>): GeneratedType {
  const seed: { pairs: Array<{ k: string; v: string }>; imports: ImportDef[] } = {
    pairs: [],
    imports: [],
  };

  const result = Object.entries(obj).reduce((acc, [key, value]) => {
    if (Object.prototype.hasOwnProperty.call(propToTypeMap, key)) {
      const { output, imports } = generateTypeForKnownKey(
        key as KnownKey,
        value,
      );
      return {
        pairs: acc.pairs.concat({
          k: key,
          v: output,
        }),
        imports: acc.imports.concat(imports),
      };
    } else {
      const { output, imports } = generateTypeForUnknownKey(value);
      return {
        pairs: acc.pairs.concat({
          k: key,
          v: output,
        }),
        imports: acc.imports.concat(imports),
      };
    }
  }, seed);

  return {
    output: "{" +
      result.pairs.map(({ k, v }) => `${JSON.stringify(k, null, 2)}?: ${v}`)
        .join("\n") +
      "}",
    imports: result.imports,
  };
}

interface JsonSchemaObject {
  properties: Record<string, unknown>;
}

function applyIfJsonSchemaObject(
  schema: unknown,
  apply: (o: JsonSchemaObject) => unknown,
): unknown {
  if (
    typeof schema === "object" && schema !== null && !Array.isArray(schema) &&
    ("properties" in schema)
  ) {
    return apply(schema as JsonSchemaObject);
  }

  return schema;
}

function adaptCrdSchemaOneOfItemToJsonSchema(
  item: unknown,
  propertyTypes: Record<string, string>,
) {
  return applyIfJsonSchemaObject(item, (obj) => {
    const properties = Object.fromEntries(
      Object.entries(obj.properties).map(([key, value]) => {
        if (value === null) {
          return [key, {
            type: propertyTypes[key],
          }];
        } else if (typeof value === "object") {
          return [key, {
            type: propertyTypes[key],
            ...value,
          }];
        } else {
          return [key, value];
        }
      }),
    );

    return {
      ...obj,
      properties,
      additionalProperties: false,
    };
  });
}

function isObjectSchema(schema: unknown) {
  return typeof schema === "object" && schema !== null &&
    !Array.isArray(schema);
}

function adaptCrdSchemaToJsonSchema(maybeSchema: unknown): unknown {
  if (
    typeof maybeSchema !== "object" || maybeSchema === null ||
    Array.isArray(maybeSchema)
  ) {
    return maybeSchema;
  }

  const schema = maybeSchema as Record<string, unknown>;

  if (
    schema.type === "object" && typeof schema.properties === "object" &&
    schema.properties !== null
  ) {
    const { properties, oneOf, ...rest } = schema;

    if (Array.isArray(oneOf)) {
      const propertyTypes = Object.fromEntries(
        Object
          .entries(properties)
          .filter(([_, value]) => typeof value.type !== "undefined")
          .map(([key, value]) => [key, value.type]),
      );

      const newOneOf = oneOf.map((item) => adaptCrdSchemaOneOfItemToJsonSchema(item, propertyTypes));

      return {
        ...rest,
        oneOf: newOneOf,
        additionalProperties: false,
      };
    } else {
      const newProperties = Object
        .fromEntries(
          Object
            .entries(properties)
            .map(([key, value]) => {
              const newValue = isObjectSchema(value)
                ? adaptCrdSchemaToJsonSchema(value as Record<string, unknown>)
                : value;
              return [key, newValue];
            }),
        );

      return {
        ...rest,
        properties: newProperties,
        additionalProperties: false,
      };
    }
  }

  if (schema.type === "array" && isObjectSchema(schema.items)) {
    return {
      ...schema,
      items: adaptCrdSchemaToJsonSchema(schema.items),
    };
  }

  return schema;
}

async function readChartValues(
  { chartPath, logger }: { chartPath: string; logger: Logger },
): Promise<Record<string, unknown>> {
  const baseValues: Record<string, unknown> = {};

  const subChartsPath = joinPath(chartPath, "charts");

  if (await fsExists(subChartsPath)) {
    for await (
      const entry of Deno.readDir(subChartsPath)
    ) {
      if (entry.isDirectory) {
        const subChartName = entry.name;
        const subValues = await readChartValues(
          { chartPath: joinPath(chartPath, "charts", subChartName), logger },
        );
        deepMerge(baseValues, { [subChartName]: subValues });
      }
    }
  }

  const valuesPath = joinPath(chartPath, "values.yaml");

  let values: Record<string, unknown> = {};

  if (await fsExists(valuesPath)) {
    const raw = await Deno.readTextFile(valuesPath);

    const parsed = (() => {
      try {
        return parseYaml(raw);
      } catch (e) {
        logger.warn?.(
          `Failed parsing ${valuesPath}, going to ignore it`,
          e,
        );
        return {};
      }
    })();

    values = (typeof parsed === "object" && parsed !== null) ? parsed as Record<string, unknown> : {};
  }

  return deepMerge(baseValues, values);
}

function walkAndTransformJsonSchemaInPlace(
  schema: unknown,
  transform: (node: unknown) => void,
): void {
  transform(schema);

  if (schema && typeof schema === "object") {
    if (Array.isArray(schema)) {
      for (let i = 0; i < schema.length; i++) {
        walkAndTransformJsonSchemaInPlace(schema[i], transform);
      }
    } else {
      for (const key in schema) {
        walkAndTransformJsonSchemaInPlace((schema as Record<string, unknown>)[key], transform);
      }
    }
  }
}

async function generateCrdInterface(
  { kind, group, version, schema }: {
    kind: string;
    group: string;
    version: string;
    schema: unknown;
  },
): Promise<string> {
  const fullName = `${pascalCase(kind)}${pascalCase(version)}`;
  const transformedSchema = schema ? structuredClone(schema) : {};

  walkAndTransformJsonSchemaInPlace(transformedSchema, (node) => {
    if (
      typeof node === "object" && node !== null && !("type" in node) &&
      (node as Record<string, unknown>)["x-kubernetes-preserve-unknown-fields"] === true
    ) {
      (node as Record<string, unknown>).tsType = "unknown";
    }
  });

  const generated = await jsonSchemaToTs(transformedSchema, fullName, {
    bannerComment: "",
    ignoreMinAndMaxItems: true,
    unknownAny: true,
    format: false,
  });

  const apiVersion = `${group}/${version}`;
  const fixedGenerated = generated
    .replace(/V1Alpha/g, "V1alpha")
    .replace(/V1Beta/g, "V1beta");

  const generatedWithFactory = `${fixedGenerated}
 
 export function create${fullName}(obj: ${fullName} & Pick<K8sResource, "metadata">): ${fullName} & K8sResource {
   return {
      // @ts-ignore
      apiVersion: ${JSON.stringify(apiVersion)},
      // @ts-ignore
      kind: ${JSON.stringify(kind)},
      ...obj
    }
 }
 `;

  return generatedWithFactory.replaceAll('("");', "");
}

export async function typeifyChart(
  { chartPath, typesPath, logger }: { chartPath: string; typesPath: string; logger: Logger },
) {
  const crds = await readChartCrds(chartPath);

  const schemas = crds.flatMap((crd) => {
    const kind = crd.spec.names.kind;

    if (crd.apiVersion === K8sCrdApiVersionV1beta1) {
      if (!crd.spec.version && !crd.spec.versions) {
        throw new Error(
          `Neither spec.version nor spec.versions are specified in CRD: ${crd.metadata.name}`,
        );
      }

      const versions = crd.spec.versions || [{
        name: crd.spec.version!,
      }];

      return versions.map((version) => {
        const schema = version.schema?.openAPIV3Schema ||
          (typeof crd.spec.validation === "object" && crd.spec.validation !== null &&
            (crd.spec.validation as Record<string, unknown>).openAPIV3Schema);

        if (schema) {
          return generateCrdInterface(
            {
              kind,
              group: crd.spec.group,
              version: version.name,
              schema: adaptCrdSchemaToJsonSchema(schema),
            },
          );
        }

        return Promise.resolve("");
      });
    } else {
      return crd.spec.versions.map((version) => {
        if (version.schema) {
          const schema = adaptCrdSchemaToJsonSchema(
            version.schema.openAPIV3Schema,
          );

          return generateCrdInterface(
            {
              kind,
              group: crd.spec.group,
              version: version.name,
              schema,
            },
          );
        }

        return Promise.resolve("");
      });
    }
  });

  const crdInterfaces = (await Promise.all(schemas)).join("\n");

  const values = await readChartValues({ chartPath, logger });

  const chartName = basename(chartPath);

  const patchPath = joinPath(typesPath, `patches/${chartName}.ts`);

  const hasPatch = await fsExists(patchPath);

  if (hasPatch) {
    logger.info?.(cyan(`[${chartName}]`), "Applying patch", patchPath);
  }

  const patch = hasPatch ? (await checkAndImport(patchPath)).default as TypeifyPatch : {
    patch: (v: Record<string, unknown>) => v,
  };

  const patchedValues = patch.patch(values);

  const generated = generateTypeForObject(patchedValues);
  const imports = Array
    .from(
      generated
        .imports
        .concat(patch.imports || [])
        .reduce((map, { props, from }) => {
          const current = map.get(from);

          if (!current) {
            return map.set(from, new Set(props));
          } else {
            return map.set(from, props.reduce((s, p) => s.add(p), current));
          }
        }, new Map<string, Set<string>>())
        .entries(),
    )
    .map(([from, props]) => {
      return `import {${Array.from(props).join(", ")}} from "${from}"`;
    })
    .join("\n");

  const pascalCaseChartName = pascalCase(chartName);

  const output = `
// deno-lint-ignore-file
// DO NOT MODIFY: This file was generated via "helmet typeify ..."
${imports}
import {basename, extname, joinPath, dirname, fromFileUrl, K8sResource, ChartInstanceConfig} from "@wok/helmet";

export interface ${pascalCaseChartName}ChartValues ${generated.output}

export type ${pascalCaseChartName}ChartInstanceConfig = ChartInstanceConfig<${pascalCaseChartName}ChartValues>

export const defaultName = basename(import.meta.url, extname(import.meta.url)).replaceAll("_", "-");
  
export function create${pascalCaseChartName}(config: Partial<${pascalCaseChartName}ChartInstanceConfig> & { values: ${pascalCaseChartName}ChartValues }): ${pascalCaseChartName}ChartInstanceConfig {
  return {
    name: defaultName,
    namespace: defaultName,
    path: joinPath(
      dirname(fromFileUrl(import.meta.url)),
      "../charts/${chartName}",
    ),
    ...config
  }
}

${crdInterfaces}
`;

  const outputPath = joinPath(typesPath, `${chartName}.ts`);
  await Deno.writeTextFile(
    outputPath,
    output,
  );

  const tag = gray(`[$ deno fmt ${chartName}.ts]`);
  await inheritExec({
    cmd: ["deno", "fmt", outputPath],
    stderr: {
      read: printErrLines((line) => `${tag} ${line}`),
    },
  });

  // Need to run deno fmt once more for the result to be deterministic...
  await inheritExec({
    cmd: ["deno", "fmt", outputPath],
    stderr: {
      ignore: true,
    },
  });
}

export default createCliAction(
  {
    types: Str({
      description: "Path to the destination directory where types will be generated into",
      examples: ["./types"],
    }),
    _: Arr(Str(), {
      description: "Paths to directories containing Helm charts",
      examples: [["./charts/cert-manager"]],
      minItems: 1,
    }),
  },
  async ({ types, _: charts }) => {
    const logger = getDefaultLogger();
    const resolvedTypesPath = resolvePath(types);
    await Promise.all(charts.map((chartPath) => typeifyChart({ chartPath, typesPath: resolvedTypesPath, logger })));
    return ExitCode.Zero;
  },
);
