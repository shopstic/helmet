import { captureExec, inheritExec, NonZeroExitError, printErrLines } from "@wok/utils/exec";
import { type K8sCrd, K8sCrdKind, K8sCrdSchema, type K8sResource, K8sResourceSchema } from "@wok/utils/k8s";
import { exists as fsExists, expandGlob } from "@std/fs";
import { basename, dirname, fromFileUrl, join as joinPath } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import {
  type ChartInstanceConfig,
  type ChartMetadata,
  ChartMetadataSchema,
  type HelmetBundle,
  type HelmetChartInstance,
  KubectlClientVersionCmdOutputSchema,
  KubectlServerVersionCmdOutputSchema,
} from "./types.ts";
import { memoize } from "@wok/utils/memoize";
import { parseMultiDocumentsYaml, stringifyYamlRelaxed } from "./yaml_utils.ts";
import { gray } from "@std/fmt/colors";
import { toFileUrl } from "@std/path/to-file-url";
import { Arr, createValidator, Obj, Str, type TypedSchema, validate, type ValidationResult } from "../deps/schema.ts";

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

export async function decryptAndValidateSecrets<T>(
  schema: TypedSchema<T, unknown>,
  encryptedSecretsPath: string,
): Promise<ValidationResult<T>> {
  const raw = await (async () => {
    try {
      return (await captureExec({
        cmd: ["sops", "-d", encryptedSecretsPath],
      })).out;
    } catch (e) {
      throw new Error(
        `Failed decrypting file '${encryptedSecretsPath}' with sops`,
        { cause: e },
      );
    }
  })();

  const decrypted = parseYaml(raw);

  return validate(schema, decrypted);
}

export function createK8sSecretsDecryptor<T>(
  { schema, currentFileUrl }: { schema: TypedSchema<T, unknown>; currentFileUrl: string },
): () => Promise<T> {
  const filePath = fromFileUrl(currentFileUrl);
  const name = basename(filePath, ".ts");
  const path = dirname(filePath);
  const secretsFilePath = joinPath(path, `${name}.yaml`);

  return memoize(async () => {
    const result = await decryptAndValidateSecrets(
      schema,
      secretsFilePath,
    );

    if (!result.isSuccess) {
      const errors = Array.from(result.errors);
      console.error(errors);
      throw new Error(
        `Decrypted secrets failed schema validation with ${errors.length} error(s).`,
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
      `Invalid Chart.yaml at "${chartMetaPath}". Reasons: ${JSON.stringify(chartMetaResult.errors, null, 2)}`,
    );
  }

  return chartMetaResult.value;
}

const validateCrds = createValidator(Arr(K8sCrdSchema));

export async function collectCrdFiles(chartPath: string): Promise<string[]> {
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
    const rawCrd = parseMultiDocumentsYaml(
      await Deno.readTextFile(crdFile),
    );
    const crdResult = validateCrds(rawCrd);

    if (!crdResult.isSuccess) {
      throw new Error(
        `Invalid CRD at "${crdFile}". Reasons: ${JSON.stringify(crdResult.errors, null, 2)}`,
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

const memoizedAllApiVersions = memoize(async () => {
  const apiVersionsFromEnv = Deno.env.get("HELMET_KUBECTL_API_VERSIONS");

  if (typeof apiVersionsFromEnv === "string") {
    return apiVersionsFromEnv.split(" ");
  }

  const disableCache = Boolean(Deno.env.get(
    "HELMET_KUBECTL_API_VERSIONS_DISABLE_CACHE",
  ));

  console.error(
    `Fetching all API versions (${disableCache ? "non-cached" : "cached"})`,
  );
  const { out } = await captureExec({
    cmd: [
      "kubectl",
      "api-resources",
      ...(!disableCache ? ["--cached=true"] : []),
    ],
  });

  const lines = out.split("\n").filter((l) => l.length > 0);
  const header = lines.shift();

  if (!header) {
    throw new Error("'kubectl api-resources' command did not output a header");
  }

  const headerMatch = header.match(/^(NAME(?:\s+)SHORTNAMES(?:\s+))APIVERSION/);

  if (!headerMatch) {
    throw new Error(
      "'kubectl api-resources' output header did not match the expected pattern",
    );
  }

  const apiVersionColumnPosition = headerMatch[1].length;

  return Array.from(
    new Set(lines.flatMap((line) => {
      const lineMatch = line.slice(apiVersionColumnPosition).match(
        /^([^\s]+)(?:[\s]+)(?:true|false)(?:[\s]+)([^\s]+)/,
      );
      if (!lineMatch) {
        throw new Error(
          `An 'kubectl api-resources' output line did not match the expected pattern: [LINE_START]${line}[LINE_END]`,
        );
      }

      return [lineMatch[1], `${lineMatch[1]}/${lineMatch[2]}`];
    })),
  );
});

const memoizedKubeVersion = memoize(async () => {
  const useServerVersion = Boolean(
    Deno.env.get("HELMET_KUBECTL_USE_SERVER_VERSION"),
  );

  if (useServerVersion) {
    console.error("Fetching the server-side kube version");
  }

  const cmd = [
    "kubectl",
    "version",
    "-o=json",
    ...(!useServerVersion ? ["--client=true"] : []),
  ];
  const { out } = await captureExec({
    cmd,
  });

  const json = JSON.parse(out);

  if (useServerVersion) {
    const validation = validate(KubectlServerVersionCmdOutputSchema, json);
    if (!validation.isSuccess) {
      throw new Error(`Got invalid output for command: ${cmd.join(" ")}`);
    }
    return validation.value.serverVersion.gitVersion;
  }

  const validation = validate(KubectlClientVersionCmdOutputSchema, json);
  if (!validation.isSuccess) {
    throw new Error(`Got invalid output for command: ${cmd.join(" ")}`);
  }
  return validation.value.clientVersion.gitVersion;
});

export async function helmTemplate(
  chartInstance: ChartInstanceConfig<unknown>,
): Promise<K8sResource[]> {
  const allApiVersionsPromise = memoizedAllApiVersions();
  const kubeVersionPromise = memoizedKubeVersion();

  const allApiVersions = await allApiVersionsPromise;
  const kubeVersion = await kubeVersionPromise;

  const helmTemplateCmd = [
    "helm",
    "template",
    "--disable-openapi-validation",
    "-n",
    chartInstance.namespace,
    "-f",
    "-",
    "--kube-version",
    kubeVersion,
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
        `Failed executing helm template for ${chartInstance.name}`,
        { cause: e },
      );
    }
  })();

  const docs = parseMultiDocumentsYaml(rawYaml);

  const transformedDocs: K8sResource[] = docs
    .filter((doc) => Boolean(doc))
    .map((rawDoc) => {
      const docResult = validateK8sResource(rawDoc);

      if (!docResult.isSuccess) {
        throw new Error(
          `Invalid K8s resource:
${stringifyYamlRelaxed(rawDoc)}
--------------------------------
Reasons:
${JSON.stringify(docResult.errors, null, 2)}
`,
        );
      }

      return docResult.value;
    });

  return transformedDocs;
}

const validateK8sCrd = createValidator(K8sCrdSchema);

export const HelmLsResultSchema = Arr(Obj({
  name: Str(),
  namespace: Str(),
  revision: Str(),
  updated: Str(),
  status: Str(),
  chart: Str(),
  app_version: Str(),
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
          `Invalid CRD. Reasons:\n${JSON.stringify(crdResult.errors, null, 2)}\nRaw:\n${JSON.stringify(r, null, 2)}`,
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

export async function checkAndImport(path: string) {
  const lockExists = await fsExists(joinPath(Deno.cwd(), "deno.lock"));

  try {
    await inheritExec({
      cmd: ["deno", "check", ...(!lockExists ? ["--no-lock"] : []), path],
    });
  } catch (e) {
    if (e instanceof NonZeroExitError) {
      throw new Error(`${path} is invalid`);
    }
    throw e;
  }

  return await import(toFileUrl(path).toString());
}

export async function importBundleModule(
  path: string,
): Promise<HelmetBundle> {
  const bundleModule = await checkAndImport(path);

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
  return basename(fromFileUrl(moduleMeta.url), ".ts").replaceAll("_", "-");
}
