import { createK8sNamespace } from "../src/deps/k8s_utils.ts";
import { defineBundle } from "../src/libs/iac_utils.ts";

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
        namespace: "default",
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
