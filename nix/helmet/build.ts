import { type ImportMap, transpile } from "https://deno.land/x/emit@0.38.3/mod.ts";
import { dirname, fromFileUrl, join, relative, resolve, toFileUrl } from "@std/path";
import { ImportMap as JspmImportMap } from "npm:@jspm/import-map@1.0.8";
import ts from "npm:typescript@5.4.4";
import { assert } from "@std/assert";
import { inheritExec } from "@wok/utils/exec";

const outPath = Deno.args[0];

if (!outPath) {
  throw new Error("Output path is required");
}

const rootPath = Deno.cwd();
const appPath = join(rootPath, "src/helmet.ts");

await inheritExec({
  cmd: ["deno", "vendor", appPath],
});

const importMapPath = "./vendor/import_map.json";
const importMap: ImportMap = JSON.parse(await Deno.readTextFile(importMapPath));
const result = await transpile(appPath, {
  importMap: importMapPath,
  allowRemote: false,
});

const mapUrl = toFileUrl(resolve(rootPath, "vendor/import_map.json"));
const jspmImportMap = new JspmImportMap({
  mapUrl,
  map: importMap,
});

function rewriteModuleSpecifier(path: string, specifier: string) {
  if (!specifier.startsWith(".")) {
    const parentPath = dirname(path);
    const parentUrl = toFileUrl(parentPath);
    const resolved = jspmImportMap.resolve(specifier, parentUrl);
    const resolvedRelative = relative(parentPath, fromFileUrl(resolved));

    // console.log(`Resolved ${specifier} at ${path} absolute ${fromFileUrl(resolved)} to ${resolvedRelative}`);
    return `./${resolvedRelative.replace(/\.ts$/, ".js")}`;
  }

  return specifier.replace(/\.ts$/, ".js");
}

function transformFile(filePath: string, sourceCode: string) {
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceCode,
    ts.ScriptTarget.Latest, // Parse using latest script target
    true, // Set parent nodes
  );

  const transformer: ts.TransformerFactory<ts.SourceFile> = (ctx: ts.TransformationContext) => {
    const { factory } = ctx;
    return (sourceFile: ts.SourceFile) => {
      function visit(node: ts.Node): ts.Node {
        if (ts.isImportDeclaration(node)) {
          if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
            return factory.updateImportDeclaration(
              node,
              node.modifiers,
              node.importClause,
              factory.createStringLiteral(rewriteModuleSpecifier(filePath, node.moduleSpecifier.text)),
              node.attributes,
            );
          }

          return node;
        }

        if (ts.isExportDeclaration(node)) {
          if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
            return factory.updateExportDeclaration(
              node,
              node.modifiers,
              node.isTypeOnly,
              node.exportClause,
              factory.createStringLiteral(rewriteModuleSpecifier(filePath, node.moduleSpecifier.text)),
              node.attributes,
            );
          }

          return node;
        }

        return ts.visitEachChild(node, visit, ctx);
      }

      const ret = ts.visitNode(sourceFile, visit);
      assert(ts.isSourceFile(ret));
      return ret;
    };
  };

  const ret = ts.transform(sourceFile, [transformer]);
  assert(ret.transformed.length === 1);
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  return printer.printFile(ret.transformed[0]);
}

// const rewriteImports = (path: string, content: string) => {
//   return content.replace(
//     /(import|export)\s([\s\S]+?)\sfrom([\s\S]+?)['|"]([^'"]+)['|"]/g,
//     (_, one, two, three, four) => {
//       if (!four.startsWith(".")) {
//         const parentUrl = toFileUrl(dirname(path));

//         try {
//           const resolved = jspmImportMap.resolve(four, parentUrl);
//           const resolvedRelative = relative(rootPath, fromFileUrl(resolved));
//           const resolvedRelativePath = `./${resolvedRelative.replace(/\.ts$/, ".js")}`;
//           return `${one} ${two} from${three}"${resolvedRelativePath}"`;
//         } catch {
//           console.warn(`Failed to resolve ${four} in ${path}`, one, two, three);
//           // Ignore
//         }
//       }

//       return `${one}${two}from${three}"${four.replace(/\.ts$/, ".js")}"`;
//     }, /* `$1$2from$3"$4.js"` */
//   );
// };

const promises = Array.from(result).map(async ([key, content]) => {
  const path = fromFileUrl(key);
  const newPath = join(outPath, relative(rootPath, path).replace(/\.ts$/, ".js"));
  const newParentDir = dirname(newPath);
  await Deno.mkdir(newParentDir, { recursive: true });
  await Deno.writeTextFile(newPath, transformFile(path, content));
  console.log(`Wrote ${newPath}`);
});
await Promise.all(promises);

// const updatedImportMap = {
//   imports: Object.fromEntries(
//     Object.entries(importMap.imports ?? {}).map(([key, value]) => {
//       return [key, value.replace(/\.ts$/, ".js")];
//     }),
//   ),
//   scopes: Object.fromEntries(
//     Object.entries(importMap.scopes ?? {}).map(([scopeKey, scope]) => {
//       return [
//         scopeKey,
//         Object.fromEntries(
//           Object.entries(scope).map(([key, value]) => {
//             return [key, value.replace(/\.ts$/, ".js")];
//           }),
//         ),
//       ];
//     }),
//   ),
// } satisfies ImportMap;

// Deno.writeTextFile(join(outPath, "vendor", "import_map.json"), JSON.stringify(updatedImportMap, null, 2));
