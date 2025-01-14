import type { K8sCrd, K8sResource } from "@wok/utils/k8s";
import type { Range as SemverRange } from "@std/semver";
import { Arr, Bool, Obj, Opt, Rec, Str, Unk } from "../deps/schema.ts";

export const ChartRepoReleaseSchema = Obj({
  apiVersion: Opt(Str()),
  version: Str(),
  name: Str(),
  urls: Arr(Str()),
}, {
  additionalProperties: true,
});

export type ChartRepoRelease = typeof ChartRepoReleaseSchema.infer;

export const ChartRepoIndexSchema = Obj({
  apiVersion: Str(),
  entries: Rec(
    Str(),
    Arr(ChartRepoReleaseSchema),
  ),
}, {
  additionalProperties: true,
});

export type ChartRepoIndex = typeof ChartRepoIndexSchema.infer;

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

export const ChartMetadataSchema = Obj({
  apiVersion: Str(),
  name: Str(),
  version: Str(),
  kubeVersion: Opt(Str()), // A SemVer range of compatible Kubernetes versions (optional)
  description: Opt(Str()), // A single-sentence description of this project (optional)
  type: Opt(Str()), // The type of the chart (optional)
  keywords: Opt(Arr(Str())), // A list of keywords about this project (optional)
  home: Opt(Str()), // The URL of this projects home page (optional)
  sources: Opt(Arr(Str())), // A list of URLs to source code for this project (optional)
  dependencies: Opt(Unk()), // A list of the chart requirements (optional)
  maintainers: Opt(Unk()),
  icon: Opt(Str()), // A URL to an SVG or PNG image to be used as an icon (optional).
  appVersion: Opt(Str()), // The version of the app that this contains (optional). This needn't be SemVer.
  deprecated: Opt(Bool()), // Whether this chart is deprecated (optional, boolean)
  annotations: Opt(Unk()),
}, {
  additionalProperties: true,
});

export type ChartMetadata = typeof ChartMetadataSchema.infer;

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

export const KubectlClientVersionCmdOutputSchema = Obj({
  clientVersion: Obj({
    gitVersion: Str({ minLength: 1 }),
  }, {
    additionalProperties: true,
  }),
}, {
  additionalProperties: true,
});

export const KubectlServerVersionCmdOutputSchema = Obj({
  serverVersion: Obj({
    gitVersion: Str({ minLength: 1 }),
  }, {
    additionalProperties: true,
  }),
}, {
  additionalProperties: true,
});
