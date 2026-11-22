// Lets `node --test` run the TypeScript sources directly (Node ≥ 22.18 strips types):
// resolves the "@/" path alias from tsconfig.json and extensionless relative imports.
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = new URL("../", import.meta.url);
const EXTENSIONS = [".ts", ".tsx", "/index.ts"];

registerHooks({
  resolve(specifier, context, nextResolve) {
    let target = null;
    if (specifier.startsWith("@/")) target = new URL(specifier.slice(2), root);
    else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
      target = new URL(specifier, context.parentURL);
    }
    if (target && !existsSync(fileURLToPath(target))) {
      const found = EXTENSIONS.map(ext => fileURLToPath(target) + ext).find(existsSync);
      if (found) return nextResolve(pathToFileURL(found).href, context);
    }
    return nextResolve(target ? target.href : specifier, context);
  }
});
