import { stringifyYamlRelaxed } from "../libs/yaml_utils.ts";
import type { HelmetChartInstance } from "../libs/types.ts";
import { join as joinPath, resolve as resolvePath } from "@std/path";
import { createCliAction, ExitCode } from "@wok/utils/cli";
import { cyan } from "@std/fmt/colors";
import { importBundleModule } from "../libs/iac_utils.ts";
import { K8sKind } from "@wok/utils/k8s";
import { Str } from "../deps/schema.ts";

async function generateChildChart(
  { crdsPath, resourcesPath, namespacesPath, instance }: {
    crdsPath: string;
    resourcesPath: string;
    namespacesPath: string;
    instance: HelmetChartInstance;
  },
): Promise<void> {
  const resourcesWithoutNamespaces = instance.resources.filter((r) => r.kind !== "Namespace");
  const namespaces = instance
    .resources
    .filter((r) => r.kind === "Namespace")
    .map((r) => ({
      ...r,
      metadata: {
        ...r.metadata,
        labels: {
          ...r.metadata?.labels,
          // Kubernetes 1.21+ adds this by default. We're adding it explicitly
          // for <1.21 clusters
          "kubernetes.io/metadata.name": r.metadata.name,
        },
      },
    }));

  const combinedResourcesYaml = (await Promise.all(resourcesWithoutNamespaces
    .map((doc) => {
      const namespace = (doc.metadata.namespace !== undefined) ? doc.metadata.namespace : instance.namespace;

      return stringifyYamlRelaxed({
        ...doc,
        metadata: {
          ...doc.metadata,
          namespace,
          labels: {
            ...instance.labels,
            ...doc.metadata.labels,
          },
        },
      });
    })))
    .join("---\n");

  const combinedNamespacesYaml = (await Promise.all(namespaces
    .map((doc) => stringifyYamlRelaxed(doc))))
    .join("---\n");

  const combinedCrdsYaml = (await Promise.all(instance
    .crds
    .map((doc) => stringifyYamlRelaxed(doc))))
    .join("---\n");

  await Promise.all([
    Deno.writeTextFile(
      joinPath(resourcesPath, `${instance.name}.yaml`),
      combinedResourcesYaml,
    ),
    Deno.writeTextFile(
      joinPath(namespacesPath, `${instance.name}.yaml`),
      combinedNamespacesYaml,
    ),
    (combinedCrdsYaml.length > 0)
      ? Deno.writeTextFile(
        joinPath(crdsPath, `${instance.name}.yaml`),
        combinedCrdsYaml,
      )
      : Promise.resolve(),
  ]);
}

async function generateChart(
  { name, chartPath, version }: {
    name: string;
    chartPath: string;
    version: string;
  },
) {
  const templatesPath = joinPath(chartPath, "templates");
  const renderedPath = joinPath(chartPath, "rendered");

  await Deno.mkdir(templatesPath, { recursive: true });
  await Deno.mkdir(renderedPath, { recursive: true });

  await Deno.writeTextFile(
    joinPath(chartPath, "Chart.yaml"),
    stringifyYamlRelaxed({
      apiVersion: "v2",
      type: "application",
      name: name,
      version,
    }),
  );

  await Deno.writeTextFile(
    joinPath(templatesPath, "template.yaml"),
    `{{ $currentScope := .}}
{{ range $path, $_ :=  .Files.Glob  "rendered/*.yaml" }}
{{- with $currentScope}}
---
{{ .Files.Get $path }}
{{- end }}
{{ end }}`,
  );
}

export async function generateParentChart(
  { name, version, targetPath, children }: {
    name: string;
    version: string;
    targetPath: string;
    children: HelmetChartInstance[];
  },
): Promise<void> {
  const crdsPath = joinPath(targetPath, "crds");
  const namespacesPath = joinPath(targetPath, "namespaces");
  const resourcesPath = joinPath(targetPath, "resources");

  await Promise.all([
    generateChart({
      name: `${name}-crds`,
      chartPath: crdsPath,
      version,
    }),
    generateChart({
      name: `${name}-namespaces`,
      chartPath: namespacesPath,
      version,
    }),
    generateChart({
      name: `${name}-resources`,
      chartPath: resourcesPath,
      version,
    }),
  ]);

  await Promise.all(
    children
      .map((instance) =>
        generateChildChart({
          crdsPath: joinPath(crdsPath, "rendered"),
          resourcesPath: joinPath(resourcesPath, "rendered"),
          namespacesPath: joinPath(namespacesPath, "rendered"),
          instance,
        })
          .then(() => console.error("Generated instance", cyan(instance.name)))
      ),
  );
}

export async function compile(
  args: {
    version: string;
    source: string;
    destination: string;
  },
) {
  const source = resolvePath(args.source);
  const destination = resolvePath(args.destination);

  console.error("Importing module", cyan(source));

  const bundleModule = await importBundleModule(source);

  if (!bundleModule.releaseId) {
    throw new Error(
      `Instance module does not export an 'id' const, please check: ${source}`,
    );
  }

  const releaseId = bundleModule.releaseId;

  console.error("Creating bundle with releaseId", cyan(releaseId));
  const chartInstances = await bundleModule.create();

  if (!Array.isArray(chartInstances)) {
    throw new Error(
      `Instance module 'create' function does not return Promise<HelmetChartInstance[]>, please check: ${source}`,
    );
  }

  const chartInstanceDuplicateDetectionMap = chartInstances.reduce((map, { name }) => {
    const count = map.get(name) ?? 0;
    map.set(name, count + 1);
    return map;
  }, new Map<string, number>());

  const resourceDuplicateDetectionMap = chartInstances.flatMap((
    { namespace, crds, resources },
  ) => [
    ...crds,
    ...resources.map((r) => {
      const { kind, apiVersion, metadata } = r;
      return kind !== K8sKind.Namespace && metadata.namespace === undefined
        ? ({
          kind,
          apiVersion,
          metadata: {
            name: metadata.name,
            namespace,
          },
        })
        : r;
    }),
  ]).reduce(
    (map, resource) => {
      const namespace = resource.metadata.namespace as string | undefined ?? "";
      const kind = `${resource.kind}/${resource.apiVersion}`;
      let byNamespaceMap = map.get(kind);

      if (!byNamespaceMap) {
        byNamespaceMap = new Map<string, Map<string, number>>();
        map.set(kind, byNamespaceMap);
      }

      let byNameMap = byNamespaceMap.get(namespace);

      if (!byNameMap) {
        byNameMap = new Map<string, number>();
        byNamespaceMap.set(namespace, byNameMap);
      }

      const name = resource.metadata.name;
      const count = byNameMap.get(name) ?? 0;
      byNameMap.set(name, count + 1);
      return map;
    },
    new Map<string, Map<string, Map<string, number>>>(),
  );

  for (const [name, count] of chartInstanceDuplicateDetectionMap) {
    if (count > 1) {
      throw new Error(`There are ${count} instances with the same name of '${name}'`);
    }
  }

  for (const [kind, byNamespaceMap] of resourceDuplicateDetectionMap) {
    for (const [namespace, byNameMap] of byNamespaceMap) {
      for (const [name, count] of byNameMap) {
        if (count > 1) {
          throw new Error(
            `There are ${count} resources with the same name of '${name}' and kind of '${kind}'${
              namespace.length > 0 ? ` in namespace '${namespace}'` : ""
            }`,
          );
        }
      }
    }
  }

  console.error("Compiling", source, "to", destination);

  await generateParentChart(
    {
      name: releaseId,
      version: args.version,
      targetPath: destination,
      children: chartInstances,
    },
  );
}

export default createCliAction({
  version: Str({
    description: "Version to write to the generated Chart.yaml",
    examples: ["1.0.0"],
  }),
  source: Str({
    description: "Path to the instance module's source",
    examples: ["./instances/prod.ts"],
  }),
  destination: Str({
    description: "Destination path to generate the Helm chart to",
    examples: ["/path/to/compiled-prod-chart"],
  }),
}, async ({ version, source, destination }) => {
  await compile({
    version,
    source,
    destination,
  });

  return ExitCode.Zero;
});
