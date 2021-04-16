import { deepMerge } from "../libs/patch-utils.ts";

import { ImportDef, readChartCrds, TypeifyPatch } from "../libs/iac-utils.ts";
import { basename, joinPath, resolvePath } from "../deps/std-path.ts";
// TODO: Temporary workaround until this ends up in the next deno release https://github.com/denoland/deno/issues/10174
export { joinGlobs } from "https://deno.land/std@0.93.0/path/glob.ts";
import { expandGlob, expandGlobSync, fsExists } from "../deps/std-fs.ts";
import { parseYaml } from "../deps/std-yaml.ts";
import { toPascalCase } from "../deps/case.ts";
import { captureExec, inheritExec } from "../deps/exec-utils.ts";
import { K8sCrdApiVersionV1beta1 } from "../deps/k8s-utils.ts";
import { createCliAction, ExitCode } from "../deps/cli-utils.ts";
import { Type } from "../deps/typebox.ts";
import { cyan, gray } from "../deps/std-fmt-colors.ts";

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

const k8sModelImportRoot =
  "https://raw.githubusercontent.com/shopstic/k8s-deno-client/1.19.2/models/";

export const localObjectReferencesType: TypeDef = {
  expectation: (value) => value === null || classifyType(value) === "array",
  type: "Array<IoK8sApiCoreV1LocalObjectReference>",
  imports: [
    {
      props: ["IoK8sApiCoreV1LocalObjectReference"],
      from: `${k8sModelImportRoot}IoK8sApiCoreV1LocalObjectReference.ts`,
    },
  ],
};

export const pullPolicyType: TypeDef = {
  expectation: (value) => classifyType(value) === "string",
  type: "K8sImagePullPolicy",
  imports: [
    {
      props: ["K8sImagePullPolicy"],
      from: `../deps/helmet.ts`,
    },
  ],
};

export const annotationsType: TypeDef = {
  expectation: (value) => value === null || classifyType(value) === "object",
  type: `IoK8sApimachineryPkgApisMetaV1ObjectMeta['annotations']`,
  imports: [
    {
      props: ["IoK8sApimachineryPkgApisMetaV1ObjectMeta"],
      from: `${k8sModelImportRoot}IoK8sApimachineryPkgApisMetaV1ObjectMeta.ts`,
    },
  ],
};

export const labelsType: TypeDef = {
  expectation: (value) => value === null || classifyType(value) === "object",
  type: `IoK8sApimachineryPkgApisMetaV1ObjectMeta['labels']`,
  imports: [
    {
      props: ["IoK8sApimachineryPkgApisMetaV1ObjectMeta"],
      from: `${k8sModelImportRoot}IoK8sApimachineryPkgApisMetaV1ObjectMeta.ts`,
    },
  ],
};

export const securityContextType: TypeDef = {
  expectation: (value) => value === null || classifyType(value) === "object",
  type: `IoK8sApiCoreV1SecurityContext`,
  imports: [
    {
      props: ["IoK8sApiCoreV1SecurityContext"],
      from: `${k8sModelImportRoot}IoK8sApiCoreV1SecurityContext.ts`,
    },
  ],
};

export const resources: TypeDef = {
  expectation: (value) => value === null || classifyType(value) === "object",
  type: `IoK8sApiCoreV1ResourceRequirements`,
  imports: [
    {
      props: ["IoK8sApiCoreV1ResourceRequirements"],
      from: `${k8sModelImportRoot}IoK8sApiCoreV1ResourceRequirements.ts`,
    },
  ],
};

export const nodeSelectorType: TypeDef = {
  expectation: (value) => value === null || classifyType(value) === "object",
  type: `IoK8sApiCoreV1PodSpec['nodeSelector']`,
  imports: [
    {
      props: ["IoK8sApiCoreV1PodSpec"],
      from: `${k8sModelImportRoot}IoK8sApiCoreV1PodSpec.ts`,
    },
  ],
};

export const tolerationsType: TypeDef = {
  expectation: (value) => value === null || classifyType(value) === "array",
  type: `IoK8sApiCoreV1PodSpec['tolerations']`,
  imports: [
    {
      props: ["IoK8sApiCoreV1PodSpec"],
      from: `${k8sModelImportRoot}IoK8sApiCoreV1PodSpec.ts`,
    },
  ],
};

export const resourcesType: TypeDef = {
  expectation: (value) => value === null || classifyType(value) === "object",
  type: `IoK8sApiCoreV1ResourceRequirements`,
  imports: [
    {
      props: ["IoK8sApiCoreV1ResourceRequirements"],
      from: `${k8sModelImportRoot}IoK8sApiCoreV1ResourceRequirements.ts`,
    },
  ],
};

export const affinityType: TypeDef = {
  expectation: (value) => value === null || classifyType(value) === "object",
  type: `IoK8sApiCoreV1PodSpec['affinity']`,
  imports: [
    {
      props: ["IoK8sApiCoreV1PodSpec"],
      from: `${k8sModelImportRoot}IoK8sApiCoreV1PodSpec.ts`,
    },
  ],
};

export const envType: TypeDef = {
  expectation: (value) => value === null || classifyType(value) === "array",
  type: `IoK8sApiCoreV1Container['env']`,
  imports: [
    {
      props: ["IoK8sApiCoreV1Container"],
      from: `${k8sModelImportRoot}IoK8sApiCoreV1Container.ts`,
    },
  ],
};

const propToTypeMap = {
  imagePullSecrets: localObjectReferencesType,
  pullPolicy: pullPolicyType,
  imagePullPolicy: pullPolicyType,
  labels: labelsType,
  annotations: annotationsType,
  podAnnotations: annotationsType,
  podSecurityContext: securityContextType,
  securityContext: securityContextType,
  nodeSelector: nodeSelectorType,
  tolerations: tolerationsType,
  affinity: affinityType,
  resources: resourcesType,
  env: envType,
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
  const seed: { pairs: Array<{ k: string; v: string }>; imports: ImportDef[] } =
    {
      pairs: [],
      imports: [],
    };

  const result = Object.entries(obj).reduce((acc, [key, value]) => {
    if (propToTypeMap.hasOwnProperty(key)) {
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

      const newOneOf = oneOf.map((item) =>
        adaptCrdSchemaOneOfItemToJsonSchema(item, propertyTypes)
      );

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

  for await (
    const entry of expandGlob("*", {
      root: joinPath(chartPath, "charts"),
    })
  ) {
    const subChartName = entry.name;
    const subValues = await readChartValues(
      joinPath(chartPath, "charts", subChartName),
    );
    deepMerge(baseValues, { [subChartName]: subValues });
  }

  const valuesPath = joinPath(chartPath, "values.yaml");
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

  const values = (typeof parsed === "object" && parsed !== null)
    ? parsed as Record<string, unknown>
    : {};

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

    const generated = await captureExec({
      run: {
        cmd: [
          "json2ts",
          `--input=${tempFile}`,
          `--bannerComment=""`,
        ],
      },
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
        const schema = version.schema || crd.spec.validation?.openAPIV3Schema;

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

  const patch = (hasPatch)
    ? (await import(patchPath)).default as TypeifyPatch
    : {
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

  await inheritExec({
    run: { cmd: ["deno", "fmt", outputPath] },
    stderrTag: gray(`[$ deno fmt ${chartName}.ts]`),
  });

  // Need to run deno fmt once more for the result to be deterministic...
  await inheritExec({
    run: { cmd: ["deno", "fmt", outputPath] },
    ignoreStderr: true,
  });
}

export default createCliAction(
  Type.Object({
    charts: Type.String({
      description:
        "Glob pattern to match directories of Helm charts, for which types will be generated",
      examples: ["./charts/*"],
    }),
    types: Type.String({
      description:
        "Path to the destination directory where types will be generated into",
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
        .map((entry) => typeifyChart(entry.path, resolvedTypesPath)),
    );

    return ExitCode.Zero;
  },
);
