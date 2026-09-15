import { build } from "esbuild";
await build({
  entryPoints: ["preview/bridge.ts"],
  outfile: "preview/dist/bridge.js",
  bundle: true,
  minify: true,
  format: "iife",
  target: ["es2022"],
  platform: "browser",
  legalComments: "none",
});
