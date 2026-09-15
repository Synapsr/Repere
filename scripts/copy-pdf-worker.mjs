import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
const pdfPackage = new URL("../node_modules/pdfjs-dist/", import.meta.url);
const { version } = JSON.parse(readFileSync(new URL("package.json", pdfPackage), "utf8"));
const assets = new URL(`../public/pdfjs/${version}/`, import.meta.url);
mkdirSync(assets, { recursive: true });
copyFileSync(
  new URL("build/pdf.worker.min.mjs", pdfPackage),
  new URL("pdf.worker.min.mjs", assets),
);
rmSync(new URL("../public/pdf.worker.min.mjs", import.meta.url), { force: true });

// PDF.js 6 decodes even CCITT fax scans through an external module. Preserve the
// matching binaries, JavaScript fallbacks, CMaps and all their upstream notices.
for (const directory of ["cmaps", "iccs"]) {
  cpSync(new URL(directory, pdfPackage), new URL(directory, assets), { recursive: true });
}
for (const [directory, files] of [
  [
    "wasm",
    [
      "jbig2.wasm",
      "jbig2_nowasm_fallback.js",
      "openjpeg.wasm",
      "openjpeg_nowasm_fallback.js",
      "qcms_bg.wasm",
      "LICENSE_JBIG2",
      "LICENSE_OPENJPEG",
      "LICENSE_QCMS",
      "LICENSE_PDFJS_JBIG2",
      "LICENSE_PDFJS_OPENJPEG",
      "LICENSE_PDFJS_QCMS",
    ],
  ],
  // With useSystemFonts enabled, only these two standard fonts require a file.
  ["standard_fonts", ["FoxitSymbol.pfb", "FoxitDingbats.pfb", "LICENSE_FOXIT"]],
]) {
  mkdirSync(new URL(`${directory}/`, assets), { recursive: true });
  for (const file of files) {
    copyFileSync(
      new URL(`${directory}/${file}`, pdfPackage),
      new URL(`${directory}/${file}`, assets),
    );
  }
}

// Next emits fonts and icons into static bundles without copying their package licenses.
// Keep the original copyright and complete license texts alongside the distributed assets.
const licenses = new URL("../public/licenses/", import.meta.url);
mkdirSync(licenses, { recursive: true });
for (const [packageName, fileName] of [
  ["pdfjs-dist", "pdfjs-dist"],
  ["@fontsource-variable/dm-sans", "dm-sans"],
  ["@fontsource-variable/manrope", "manrope"],
  ["lucide-react", "lucide-react"],
  ["next-intl", "next-intl"],
  ["use-intl", "use-intl"],
]) {
  const directory = new URL(`../node_modules/${packageName}/`, import.meta.url);
  copyFileSync(new URL("LICENSE", directory), new URL(`${fileName}.LICENSE.txt`, licenses));
  // Preserve a separate upstream NOTICE if a future pinned release introduces one.
  for (const name of ["NOTICE", "NOTICE.txt", "NOTICE.md"]) {
    const notice = new URL(name, directory);
    const destination = new URL(`${fileName}.${name}`, licenses);
    if (existsSync(notice)) copyFileSync(notice, destination);
    else rmSync(destination, { force: true });
  }
}
