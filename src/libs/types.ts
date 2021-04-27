import { K8sCrdSchema, K8sResource } from "../deps/k8s_utils.ts";
import { SemverRange } from "../deps/semver.ts";
import { Static, TObject, TProperties, Type } from "../deps/typebox.ts";

export const ChartRepoReleaseSchema = RelaxedObject({
  apiVersion: Type.Optional(Type.String()),
  version: Type.String(),
  name: Type.String(),
  urls: Type.Array(Type.String()),
});

export type ChartRepoRelease = Static<typeof ChartRepoReleaseSchema>;

export const ChartRepoIndexSchema = RelaxedObject({
  apiVersion: Type.String(),
  entries: Type.Dict(
    Type.Array(ChartRepoReleaseSchema),
  ),
});

export type ChartRepoIndex = Static<typeof ChartRepoIndexSchema>;

export enum RemoteChartSource {
  HelmRepo,
  OciRegistry,
  RemoteArchive,
}

export interface HelmRepoChartConfig {
  source: RemoteChartSource.HelmRepo;
  remoteName: string;
  remoteRepoUrl: string;
  apiVersion?: "v1" | "v2";
  version: string | SemverRange;
}

export interface OciRegistryChartConfig {
  source: RemoteChartSource.OciRegistry;
  ociRef: string;
  version: string;
}

export interface RemoteArchiveChartConfig {
  source: RemoteChartSource.RemoteArchive;
  archiveUrl: string;
  extractPath: string;
  version: string;
}

export type RemoteChartConfig =
  | HelmRepoChartConfig
  | OciRegistryChartConfig
  | RemoteArchiveChartConfig;

export type RemoteChartConfigMap = {
  [name: string]: RemoteChartConfig;
};

function RelaxedObject<T extends TProperties>(
  properties: T,
): TObject<T> {
  return Type.Object<T>(properties, { additionalProperties: true });
}

export const ChartMetadataSchema = RelaxedObject({
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
});

export type ChartMetadata = Static<typeof ChartMetadataSchema>;

export interface ChartInstanceConfig<V> {
  name: string;
  namespace: string;
  path: string;
  values: V;
}

export type K8sCrd = Static<typeof K8sCrdSchema>;

export interface ChartInstance {
  name: string;
  namespace: string;
  version: string;
  labels: { [key: string]: string };
  resources: K8sResource[];
  crds: K8sCrd[];
}
