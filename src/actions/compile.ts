import { stringifyYamlRelaxed } from "../libs/yaml_utils.ts";
import { HelmetChartInstance } from "../libs/types.ts";
import { joinPath, resolvePath } from "../deps/std_path.ts";
import { createCliAction, ExitCode } from "../deps/cli_utils.ts";
import { Type } from "../deps/typebox.ts";
import { cyan } from "../deps/std_fmt_colors.ts";
import { importBundleModule } from "../libs/iac_utils.ts";

async function generateChildChart(
  { crdsPath, resourcesPath, namespacesPath, instance }: {
    crdsPath: string;
    resourcesPath: string;
    namespacesPath: string;
    instance: HelmetChartInstance;
  },
): Promise<void> {
  const resourcesWithoutNamespaces = instance.resources.filter((r) =>
    r.kind !== "Namespace"
  );
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

  const combinedResourcesYaml = resourcesWithoutNamespaces
    .map((doc) => {
      const namespace = (doc.metadata.namespace !== undefined)
        ? doc.metadata.namespace
        : instance.namespace;

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
    })
    .join("---\n");

  const combinedNamespacesYaml = namespaces
    .map((doc) => stringifyYamlRelaxed(doc))
    .join("---\n");

  const combinedCrdsYaml = instance
    .crds
    .map((doc) => stringifyYamlRelaxed(doc))
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

  await Deno.mkdir(templatesPath, { recursive: true });
  await Deno.writeTextFile(
    joinPath(chartPath, "Chart.yaml"),
    stringifyYamlRelaxed({
      apiVersion: "v2",
      type: "application",
      name: name,
      version,
    }),
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
          crdsPath: joinPath(crdsPath, "templates"),
          resourcesPath: joinPath(resourcesPath, "templates"),
          namespacesPath: joinPath(namespacesPath, "templates"),
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

export default createCliAction(
  Type.Object({
    version: Type.String({
      description: "Version to write to the generated Chart.yaml",
      examples: ["1.0.0"],
    }),
    source: Type.String({
      description: "Path to the instance module's source",
      examples: ["./instances/prod.ts"],
    }),
    destination: Type.String({
      description: "Destination path to generate the Helm chart to",
      examples: ["/path/to/compiled-prod-chart"],
    }),
  }),
  async ({ version, source, destination }) => {
    await compile({
      version,
      source,
      destination,
    });

    return ExitCode.Zero;
  },
);
