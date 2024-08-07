import type { K8sCrd, K8sResource } from "@wok/utils/k8s";
import type { Range as SemverRange } from "@std/semver";
import { type Static, Type } from "@wok/typebox";

export const ChartRepoReleaseSchema = Type.Object({
  apiVersion: Type.Optional(Type.String()),
  version: Type.String(),
  name: Type.String(),
  urls: Type.Array(Type.String()),
}, {
  additionalProperties: true,
});

export type ChartRepoRelease = Static<typeof ChartRepoReleaseSchema>;

export const ChartRepoIndexSchema = Type.Object({
  apiVersion: Type.String(),
  entries: Type.Record(
    Type.String(),
    Type.Array(ChartRepoReleaseSchema),
  ),
}, {
  additionalProperties: true,
});

export type ChartRepoIndex = Static<typeof ChartRepoIndexSchema>;

export enum RemoteChartSource {
  HelmRepo,
  OciRegistry,
  RemoteArchive,
}

export interface ChartUpdateContext {
  chartPath: string;
  typesPath: string;
  remote: RemoteChartConfig;
}

interface ChartConfigHooks {
  onDownloaded?: (ctx: ChartUpdateContext) => Promise<void>;
  onUpdated?: (ctx: ChartUpdateContext) => Promise<void>;
}

export type HelmRepoChartConfig = {
  source: RemoteChartSource.HelmRepo;
  remoteName: string;
  remoteRepoUrl: string;
  apiVersion?: "v1" | "v2";
  version: string | SemverRange;
} & ChartConfigHooks;

export type OciRegistryChartConfig = {
  source: RemoteChartSource.OciRegistry;
  ociRef: string;
  version: string;
} & ChartConfigHooks;

export type RemoteArchiveChartConfig = {
  source: RemoteChartSource.RemoteArchive;
  archiveUrl: string;
  extractPath: string;
  version: string;
} & ChartConfigHooks;

export type RemoteChartConfig =
  | HelmRepoChartConfig
  | OciRegistryChartConfig
  | RemoteArchiveChartConfig;

export type RemoteChartConfigMap = {
  [name: string]: RemoteChartConfig;
};

export const ChartMetadataSchema = Type.Object({
  apiVersion: Type.String(),
  name: Type.String(),
  version: Type.String(),
  kubeVersion: Type.Optional(Type.String()), // A SemVer range of compatible Kubernetes versions (optional)
  description: Type.Optional(Type.String()), // A single-sentence description of this project (optional)
  type: Type.Optional(Type.String()), // The type of the chart (optional)
  keywords: Type.Optional(Type.Array(Type.String())), // A list of keywords about this project (optional)
  home: Type.Optional(Type.String()), // The URL of this projects home page (optional)
  sources: Type.Optional(Type.Array(Type.String())), // A list of URLs to source code for this project (optional)
  dependencies: Type.Optional(Type.Any()), // A list of the chart requirements (optional)
  maintainers: Type.Optional(Type.Any()),
  icon: Type.Optional(Type.String()), // A URL to an SVG or PNG image to be used as an icon (optional).
  appVersion: Type.Optional(Type.String()), // The version of the app that this contains (optional). This needn't be SemVer.
  deprecated: Type.Optional(Type.Boolean()), // Whether this chart is deprecated (optional, boolean)
  annotations: Type.Optional(Type.Any()),
}, {
  additionalProperties: true,
});

export type ChartMetadata = Static<typeof ChartMetadataSchema>;

export interface ChartInstanceConfig<V> {
  name: string;
  namespace: string;
  path: string;
  values: V;
}

export interface HelmetChartInstance {
  name: string;
  namespace: string;
  version: string;
  labels: { [key: string]: string };
  resources: K8sResource[];
  crds: K8sCrd[];
}

export interface HelmetBundle {
  releaseId: string;
  releaseNamespace: string;
  create: () => Promise<HelmetChartInstance[]>;
}

export const KubectlClientVersionCmdOutputSchema = Type.Object({
  clientVersion: Type.Object({
    gitVersion: Type.String({ minLength: 1 }),
  }, {
    additionalProperties: true,
  }),
}, {
  additionalProperties: true,
});

export const KubectlServerVersionCmdOutputSchema = Type.Object({
  serverVersion: Type.Object({
    gitVersion: Type.String({ minLength: 1 }),
  }, {
    additionalProperties: true,
  }),
}, {
  additionalProperties: true,
});
