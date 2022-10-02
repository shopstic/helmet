import { captureExec, printErrLines } from "../deps/exec_utils.ts";
import {
  K8sCrdKind,
  K8sCrdSchema,
  K8sResource,
  K8sResourceSchema,
} from "../deps/k8s_utils.ts";
import { expandGlob } from "../deps/std_fs.ts";
import { basename, dirname, fromFileUrl, joinPath } from "../deps/std_path.ts";
import { parseYaml } from "../deps/std_yaml.ts";
import { Static, TObject, Type } from "../deps/typebox.ts";
import { TProperties } from "../deps/typebox.ts";
import {
  createValidator,
  validate,
  ValidationResult,
} from "../deps/validation_utils.ts";
import {
  ChartInstanceConfig,
  ChartMetadata,
  ChartMetadataSchema,
  HelmetBundle,
  HelmetChartInstance,
  K8sCrd,
} from "./types.ts";
import { memoizePromise } from "../deps/async_utils.ts";
import { parseMultiDocumentsYaml, stringifyYamlRelaxed } from "./yaml_utils.ts";
import { gray } from "../deps/std_fmt_colors.ts";

export interface ImportDef {
  props: string[];
  from: string;
}

export interface TypeifyPatch {
  patch: (values: Record<string, unknown>) => Record<string, unknown>;
  imports?: ImportDef[];
}

export function createTypeifyPatch(
  patch: TypeifyPatch["patch"],
  imports?: TypeifyPatch["imports"],
): TypeifyPatch {
  return { patch, imports };
}

export async function decryptAndValidateSecrets<T extends TProperties>(
  schema: TObject<T>,
  encryptedSecretsPath: string,
): Promise<ValidationResult<Static<TObject<T>>>> {
  const raw = await (async () => {
    try {
      return (await captureExec({
        cmd: ["sops", "-d", encryptedSecretsPath],
      })).out;
    } catch (e) {
      throw new Error(
        `Failed decrypting file '${encryptedSecretsPath}' with sops, error: ${e.message}`,
      );
    }
  })();

  const decrypted = parseYaml(raw);

  return validate(schema, decrypted);
}

export function createK8sSecretsDecryptor<T extends TProperties>(
  { schema, currentFileUrl }: { schema: TObject<T>; currentFileUrl: string },
): () => Promise<Static<TObject<T>>> {
  const filePath = fromFileUrl(currentFileUrl);
  const name = basename(filePath, ".ts");
  const path = dirname(filePath);
  const secretsFilePath = joinPath(path, `${name}.yaml`);

  return memoizePromise(async () => {
    const result = await decryptAndValidateSecrets(
      schema,
      secretsFilePath,
    );

    if (!result.isSuccess) {
      console.error(result.errors);
      throw new Error(
        `Decrypted secrets failed schema validation with ${result.errors.length} error(s).`,
      );
    }

    return result.value;
  });
}

const validateChartMeta = createValidator(ChartMetadataSchema);

export async function readChartMeta(chartPath: string): Promise<ChartMetadata> {
  const chartMetaPath = joinPath(
    chartPath,
    "Chart.yaml",
  );

  const chartMetaResult = validateChartMeta(
    parseYaml(await Deno.readTextFile(chartMetaPath)),
  );

  if (!chartMetaResult.isSuccess) {
    throw new Error(
      `Invalid Chart.yaml at "${chartMetaPath}". Reasons: ${
        JSON.stringify(chartMetaResult.errors, null, 2)
      }`,
    );
  }

  return chartMetaResult.value;
}

const validateCrds = createValidator(Type.Array(K8sCrdSchema));

export async function collectCrdFiles(chartPath: string) {
  const crdsPath = joinPath(chartPath, "crds");
  const subChartsPath = joinPath(chartPath, "charts");
  const crdFiles: string[] = [];

  for await (
    const entry of expandGlob("**/*.yaml", { root: crdsPath })
  ) {
    crdFiles.push(entry.path);
  }

  for await (
    const entry of expandGlob("*", { root: subChartsPath })
  ) {
    if (entry.isDirectory) {
      crdFiles.push.apply(crdFiles, await collectCrdFiles(entry.path));
    }
  }

  return crdFiles;
}

export async function readChartCrds(chartPath: string): Promise<K8sCrd[]> {
  const crdFiles: string[] = await collectCrdFiles(chartPath);
  const parsed = await Promise.all(crdFiles.map(async (crdFile) => {
    const rawCrd = await parseMultiDocumentsYaml(
      await Deno.readTextFile(crdFile),
    );
    const crdResult = validateCrds(rawCrd);

    if (!crdResult.isSuccess) {
      throw new Error(
        `Invalid CRD at "${crdFile}". Reasons: ${
          JSON.stringify(crdResult.errors, null, 2)
        }`,
      );
    }

    return crdResult.value;
  }));

  const allCrds = parsed.flat();

  return Array.from(
    allCrds.reduce((map, crd) => {
      const name = crd.metadata.name;

      if (!map.has(name)) {
        map.set(name, crd);
      }

      return map;
    }, new Map<string, K8sCrd>()).values(),
  );
}

const validateK8sResource = createValidator(K8sResourceSchema);

const memoizedAllApiVersions = memoizePromise(async () => {
  console.error("Fetching all API versions");
  const { out } = (await captureExec({
    cmd: [
      "kubectl",
      "api-resources",
      "--no-headers",
    ],
  }));

  return Array.from(
    new Set(
      out.split("\n").filter((l) => l.length > 0).map((line) =>
        line.split(new RegExp("\\s+"))[2]
      ),
    ),
  );
});

export async function helmTemplate(
  chartInstance: ChartInstanceConfig<unknown>,
): Promise<K8sResource[]> {
  const allApiVersions = await memoizedAllApiVersions();
  const helmTemplateCmd = [
    "helm",
    "template",
    "-n",
    chartInstance.namespace,
    "-f",
    "-",
    ...(allApiVersions.flatMap((v) => ["--api-versions", v])),
    chartInstance.name,
    chartInstance.path,
  ];

  const rawYaml = await (async () => {
    try {
      const tag = gray(`[$ helm template ${chartInstance.name}]`);
      return (await captureExec({
        cmd: helmTemplateCmd,
        stderr: {
          read: printErrLines((line) => `${tag} ${line}`),
        },
        stdin: {
          pipe: stringifyYamlRelaxed(
            chartInstance.values as Record<string, unknown>,
          ),
        },
      })).out;
    } catch (e) {
      console.error(
        "INPUT -------------------------------------------------------------",
      );
      console.error(
        stringifyYamlRelaxed(
          chartInstance.values as Record<string, unknown>,
        ),
      );
      console.error(
        "COMMAND -------------------------------------------------------------",
      );
      console.error(helmTemplateCmd.join(" "));
      throw new Error(
        `Failed executing helm template for ${chartInstance.name}: ${e.toString()}`,
      );
    }
  })();

  const docs = await parseMultiDocumentsYaml(rawYaml);

  const transformedDocs: K8sResource[] = await Promise.all(
    docs
      .filter((doc) => Boolean(doc))
      .map(async (rawDoc) => {
        const docResult = validateK8sResource(rawDoc);

        if (!docResult.isSuccess) {
          throw new Error(
            `Invalid K8s resource:
${await stringifyYamlRelaxed(rawDoc)}
--------------------------------
Reasons:
${JSON.stringify(docResult.errors, null, 2)}
`,
          );
        }

        return docResult.value;
      }),
  );

  return transformedDocs;
}

const validateK8sCrd = createValidator(K8sCrdSchema);

export const HelmLsResultSchema = Type.Array(Type.Object({
  name: Type.String(),
  namespace: Type.String(),
  revision: Type.String(),
  updated: Type.String(),
  status: Type.String(),
  chart: Type.String(),
  app_version: Type.String(),
}));

export async function compileChartInstance(
  instance: ChartInstanceConfig<unknown>,
): Promise<HelmetChartInstance> {
  const meta = await readChartMeta(instance.path);

  const resources = await helmTemplate(instance);

  const resourcesWithoutCrds = resources.filter((r) => r.kind !== K8sCrdKind);
  const misplacedCrds = resources
    .filter((r) => r.kind === K8sCrdKind)
    .map((r) => {
      const crdResult = validateK8sCrd(r);

      if (!crdResult.isSuccess) {
        throw new Error(
          `Invalid CRD. Reasons:\n${
            JSON.stringify(crdResult.errors, null, 2)
          }\nRaw:\n${JSON.stringify(r, null, 2)}`,
        );
      }

      return crdResult.value;
    });

  const crds = await readChartCrds(instance.path);

  return {
    name: instance.name,
    namespace: instance.namespace,
    version: meta.version,
    labels: {
      "helm.sh/chart": `${meta.name}-${meta.version}`,
      "app.kubernetes.io/name": instance.name,
      "app.kubernetes.io/instance": instance.name,
      "app.kubernetes.io/version": meta.appVersion || "",
      "app.kubernetes.io/managed-by": "Helm",
    },
    resources: resourcesWithoutCrds,
    crds: crds.concat(misplacedCrds),
  };
}

export function defineBundle(
  instance: HelmetBundle,
): typeof instance {
  return instance;
}

export async function importBundleModule(
  path: string,
): Promise<HelmetBundle> {
  const bundleModule = await import(path);

  if (typeof bundleModule.default !== "object") {
    throw new Error(
      `Bundle module does not have a default export, please check: ${path}`,
    );
  }

  const defaultExport = bundleModule.default;

  if (
    typeof defaultExport.releaseId !== "string" ||
    defaultExport.releaseId.length === 0
  ) {
    throw new Error(
      `Bundle module default export does not contain a valid 'releaseId' property, please check: ${path}`,
    );
  }

  if (
    typeof defaultExport.releaseNamespace !== "string" ||
    defaultExport.releaseNamespace.length === 0
  ) {
    throw new Error(
      `Bundle module default export does not contain a valid 'releaseNamespace' property, please check: ${path}`,
    );
  }

  if (typeof defaultExport.create !== "function") {
    throw new Error(
      `Bundle module default export does not contain a 'create' property, please check: ${path}`,
    );
  }

  return defaultExport as HelmetBundle;
}

export function defineChart<E>(
  create: (args: E) => Promise<HelmetChartInstance>,
): typeof create {
  return create;
}

export function deriveName(moduleMeta: { url: string }): string {
  return basename(fromFileUrl(moduleMeta.url), ".ts");
}
