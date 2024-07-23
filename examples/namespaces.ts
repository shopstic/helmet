import { createK8sNamespace, defineBundle } from "../src/mod.ts";

export default defineBundle({
  releaseId: "examples-namespaces",
  releaseNamespace: "default",
  create() {
    const name = "examples";
    const seedLabels = {
      "app.kubernetes.io/name": name,
      "app.kubernetes.io/instance": name,
    };

    return Promise.all([
      Promise.resolve({
        name,
        namespace: "foo",
        version: "1.0.0",
        labels: {
          ...seedLabels,
          "app.kubernetes.io/managed-by": "Helm",
        },
        resources: [
          createK8sNamespace({
            metadata: {
              name,
            },
          }),
        ],
        crds: [],
      }),
    ]);
  },
});
