import { deepMerge } from "../libs/patch_utils.ts";

import { ImportDef, readChartCrds, TypeifyPatch } from "../libs/iac_utils.ts";
import { basename, joinPath, resolvePath } from "../deps/std_path.ts";
import { expandGlobSync, fsExists } from "../deps/std_fs.ts";
import { parseYaml } from "../deps/std_yaml.ts";
import { toPascalCase } from "../deps/case.ts";
import { captureExec, inheritExec, printErrLines } from "../deps/exec_utils.ts";
import { K8sCrdApiVersionV1beta1 } from "../deps/k8s_utils.ts";
import { createCliAction, ExitCode } from "../deps/cli_utils.ts";
import { Type } from "../deps/typebox.ts";
import { cyan, gray } from "../deps/std_fmt_colors.ts";

export type ClassifiedType =
  | "array"
  | "string"
  | "object"
  | "number"
  | "boolean"
  | "symbol"
  | "unknown";

export type Expectation = (value: unknown) => boolean;

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
    from: "../deps/helmet.ts",
  },
];

export const localObjectReferencesType: TypeDef = {
  expectation: (value) => value === null || classifyType(value) === "array",
  type: `Array<K8s["core.v1.LocalObjectReference"]>`,
  imports,
};

export const pullPolicyType: TypeDef = {
  expectation: (value) => classifyType(value) === "string",
  type: "K8sImagePullPolicy",
  imports: [
    {
      props: ["K8sImagePullPolicy"],
      from: "../deps/helmet.ts",
    },
  ],
};

export const annotationsType: TypeDef = {
  expectation: (value) => value === null || classifyType(value) === "object",
  type: "Record<string, string>",
  imports: [],
};

export const labelsType: TypeDef = {
  expectation: (value) => value === null || classifyType(value) === "object",
  type: "Record<string, string>",
  imports: [],
};

export const podSecurityContextType: TypeDef = {
  expectation: (value) => value === null || classifyType(value) === "object",
  type: `K8s["core.v1.PodSecurityContext"]`,
  imports,
};

export const securityContextType: TypeDef = {
  expectation: (value) => value === null || classifyType(value) === "object",
  type: `K8s["core.v1.SecurityContext"]`,
  imports,
};

export const nodeSelectorType: TypeDef = {
  expectation: (value) => value === null || classifyType(value) === "object",
  type: "Record<string, string>",
  imports: [],
};

export const tolerationsType: TypeDef = {
  expectation: (value) => value === null || classifyType(value) === "array",
  type: `Array<K8s["core.v1.Toleration"]>`,
  imports,
};

export const resourcesType: TypeDef = {
  expectation: (value) => value === null || classifyType(value) === "object",
  type: `K8s["core.v1.ResourceRequirements"]`,
  imports,
};

export const affinityType: TypeDef = {
  expectation: (value) => value === null || classifyType(value) === "object",
  type: `K8s["core.v1.Affinity"]`,
  imports,
};

export const envType: TypeDef = {
  expectation: (value) => value === null || classifyType(value) === "array",
  type: `Array<K8s["core.v1.EnvVar"]>`,
  imports,
};

export const probeType: TypeDef = {
  expectation: (value) => value === null || classifyType(value) === "object",
  type: `K8s["core.v1.Probe"]`,
  imports,
};

export const volumesType: TypeDef = {
  expectation: (value) => value === null || classifyType(value) === "array",
  type: `Array<K8s["core.v1.Volume"]>`,
  imports,
};

export const volumeMountsType: TypeDef = {
  expectation: (value) => value === null || classifyType(value) === "array",
  type: `Array<K8s["core.v1.VolumeMount"]>`,
  imports,
};

export const dnsConfigType: TypeDef = {
  expectation: (value) => value === null || classifyType(value) === "object",
  type: `K8s["core.v1.PodDNSConfig"]`,
  imports,
};

export const containersType: TypeDef = {
  expectation: (value) => value === null || classifyType(value) === "array",
  type: `Array<K8s["core.v1.Container"]>`,
  imports,
};

export const podDisruptionBudgetType: TypeDef = {
  expectation: (value) =>
    value === null ||
    (classifyType(value) === "object" && Object.keys(value!).length === 0),
  type: `K8s["policy.v1.PodDisruptionBudgetSpec"]`,
  imports,
};

const propToTypeMap = {
  imagePullSecrets: localObjectReferencesType,
  pullPolicy: pullPolicyType,
  imagePullPolicy: pullPolicyType,
  labels: labelsType,
  podLabels: labelsType,
  extraLabels: labelsType,
  annotations: annotationsType,
  podAnnotations: annotationsType,
  podSecurityContext: podSecurityContextType,
  securityContext: securityContextType,
  containerSecurityContext: securityContextType,
  nodeSelector: nodeSelectorType,
  tolerations: tolerationsType,
  affinity: affinityType,
  resources: resourcesType,
  env: envType,
  livenessProbe: probeType,
  readinessProbe: probeType,
  volumes: volumesType,
  extraVolumes: volumesType,
  volumeMounts: volumeMountsType,
  extraVolumeMounts: volumeMountsType,
  extraHostVolumeMounts: volumeMountsType,
  dnsConfig: dnsConfigType,
  extraContainers: containersType,
  podDisruptionBudget: podDisruptionBudgetType,
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
  chartPath: string,
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
          joinPath(chartPath, "charts", subChartName),
        );
        deepMerge(baseValues, { [subChartName]: subValues });
      }
    }
  }

  const valuesPath = joinPath(chartPath, "values.yaml");

  if (!await fsExists(valuesPath)) {
    throw new Error(
      `Expected a 'values.yaml' file inside the Helm chart directory but none is found at ${valuesPath}`,
    );
  }

  const raw = await Deno.readTextFile(valuesPath);

  const parsed = (() => {
    try {
      return parseYaml(raw);
    } catch (e) {
      console.warn(
        `Failed parsing ${valuesPath}, going types ignore it. Reason: ${e.message}`,
      );
      return {};
    }
  })();

  const values = (typeof parsed === "object" && parsed !== null) ? parsed as Record<string, unknown> : {};

  return deepMerge(baseValues, values);
}

async function generateCrdInterface(
  { kind, group, version, schema }: {
    kind: string;
    group: string;
    version: string;
    schema: unknown;
  },
): Promise<string> {
  const fullName = `${toPascalCase(kind)}${toPascalCase(version)}`;
  const tempDir = await Deno.makeTempDir();

  try {
    const tempFile = joinPath(tempDir, `${fullName}.json`);

    await Deno.writeTextFile(
      tempFile,
      JSON.stringify(schema || {}, null, 2),
    );

    const generated = (await captureExec({
      cmd: [
        "json2ts",
        `--input=${tempFile}`,
        `--bannerComment=""`,
      ],
    })).out;

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
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
}

export async function typeifyChart(chartPath: string, typesPath: string) {
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
          crd.spec.validation?.openAPIV3Schema;

        if (schema) {
          return generateCrdInterface(
            {
              kind,
              group: crd.spec.group,
              version: version.name,
              schema: adaptCrdSchemaToJsonSchema(schema),
            },
          );
        } else {
          Promise.resolve("");
        }
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
        } else {
          Promise.resolve("");
        }
      });
    }
  });

  const crdInterfaces = (await Promise.all(schemas)).join("\n");

  const values = await readChartValues(chartPath);

  const chartName = basename(chartPath);

  const patchPath = joinPath(typesPath, `patches/${chartName}.ts`);

  const hasPatch = await fsExists(patchPath);

  if (hasPatch) {
    console.log(cyan(`[${chartName}]`), "Applying patch", patchPath);
  }

  const patch = (hasPatch) ? (await import(patchPath)).default as TypeifyPatch : {
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

  const pascalCaseChartName = toPascalCase(chartName);

  const output = `
// deno-lint-ignore-file
// DO NOT MODIFY: This file was generated via "helmet typeify ..."
${imports}
import {basename, extname, joinPath, dirname, fromFileUrl, K8sResource, ChartInstanceConfig} from "../deps/helmet.ts";

export interface ${pascalCaseChartName}ChartValues ${generated.output}

export type ${pascalCaseChartName}ChartInstanceConfig = ChartInstanceConfig<${pascalCaseChartName}ChartValues>

export const defaultName = basename(import.meta.url, extname(import.meta.url))
  
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
  Type.Object({
    charts: Type.String({
      description: "Glob pattern to match directories of Helm charts, for which types will be generated",
      examples: ["./charts/*"],
    }),
    types: Type.String({
      description: "Path to the destination directory where types will be generated into",
      examples: ["./types"],
    }),
  }),
  async ({ charts, types }) => {
    const resolvedTypesPath = resolvePath(types);

    await Promise.all(
      Array
        .from(expandGlobSync(charts, {
          root: Deno.cwd(),
        }))
        .filter((entry) => entry.isDirectory)
        .map((entry) => typeifyChart(entry.path, resolvedTypesPath)),
    );

    return ExitCode.Zero;
  },
);
