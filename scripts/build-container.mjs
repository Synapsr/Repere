import { build } from "esbuild";
import { cp, mkdir, readFile, readdir, rm, copyFile, access } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, ".container");
await rm(output, { recursive: true, force: true });
await mkdir(path.join(output, "preview"), { recursive: true });
await mkdir(path.join(output, "licenses"), { recursive: true });

await import("./build-preview.mjs");
await copyFile(path.join(root, "preview/dist/bridge.js"), path.join(output, "preview/bridge.js"));

const settings = {
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
};
await Promise.all([
  build({
    ...settings,
    entryPoints: ["preview/server.ts"],
    outfile: ".container/preview/server.mjs",
  }),
  build({
    ...settings,
    entryPoints: ["scripts/migrate.ts"],
    outfile: ".container/migrate.mjs",
    // mysql2 loads charset tables at runtime. Ship its small production dependency tree intact.
    external: ["mysql2"],
  }),
]);

const copied = new Set();
async function copyRuntimePackage(name, parentPackage = path.join(root, "package.json")) {
  const resolver = createRequire(parentPackage);
  let directory = path.dirname(resolver.resolve(name));
  let metadata;
  while (directory !== path.dirname(directory)) {
    try {
      const candidate = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"));
      if (candidate.name === name) {
        metadata = candidate;
        break;
      }
    } catch {
      /* The entry point may be inside lib/ or dist/. */
    }
    directory = path.dirname(directory);
  }
  if (!metadata) throw new Error(`Cannot locate runtime dependency ${name}.`);
  if (copied.has(directory)) return;
  copied.add(directory);
  const relative = path.relative(root, directory);
  if (!relative.startsWith(`node_modules${path.sep}`))
    throw new Error("Runtime dependency is outside node_modules.");
  await cp(directory, path.join(output, "runtime", relative), { recursive: true });
  for (const dependency of Object.keys(metadata.dependencies ?? {})) {
    await copyRuntimePackage(dependency, path.join(directory, "package.json"));
  }
}
await copyRuntimePackage("mysql2");

for (const name of [
  "dotenv",
  "parse5",
  "entities",
  "ipaddr.js",
  "drizzle-orm",
  "html2canvas-pro",
  "css-line-break",
  "text-segmentation",
  "utrie",
  "base64-arraybuffer",
]) {
  // drizzle-orm 0.45.2 omits LICENSE from npm; keep the unmodified release-tag license in source.
  const license =
    name === "drizzle-orm"
      ? path.join(root, "docker/all-in-one/licenses/drizzle-orm.LICENSE.txt")
      : path.join(root, "node_modules", name, "LICENSE");
  await copyFile(license, path.join(output, "licenses", `${name}.LICENSE.txt`));
  for (const notice of ["NOTICE", "NOTICE.txt", "NOTICE.md"]) {
    const source = path.join(root, "node_modules", name, notice);
    try {
      await access(source);
    } catch {
      continue;
    }
    await copyFile(source, path.join(output, "licenses", `${name}.${notice}`));
  }
}
// Next's output tracing keeps native binaries but can omit their notices. Retain
// the installed platform packages' license inventories alongside Sharp's license.
const nativePackages = [
  "sharp",
  ...(await readdir(path.join(root, "node_modules/@img")))
    .filter((name) => name.startsWith("sharp-") || name === "colour")
    .map((name) => `@img/${name}`),
];
for (const name of nativePackages) {
  const directory = path.join(root, "node_modules", name);
  const destination = path.join(output, "licenses/native", name);
  await mkdir(destination, { recursive: true });
  for (const file of await readdir(directory)) {
    if (/^(licen[cs]e|notice|copying|readme)(\.|$)|^(package|versions)\.json$/i.test(file))
      await copyFile(path.join(directory, file), path.join(destination, file));
  }
}
console.info("All-in-one preview, migrations, runtime modules and notices built.");
