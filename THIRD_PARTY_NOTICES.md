# Third-party notices

Repère's own code is covered by the root `LICENSE` (MIT). Third-party code and assets retain their upstream licenses. The application and native preview Docker images both include this notice and Repère's `LICENSE` in `/app/`.

## Application assets

`npm ci` runs `scripts/copy-pdf-worker.mjs`. It copies the PDF.js worker without changing its license header and copies the following complete upstream license files, including copyright notices, into `public/licenses/`. These generated files are excluded from Git and Docker build context; the Docker dependency stage regenerates them from the locked packages. The application image includes them at `/app/public/licenses/`, served at `/licenses/<filename>`.

| Distributed asset                                                                | Upstream package               | License                                                               | Generated license file                          |
| -------------------------------------------------------------------------------- | ------------------------------ | --------------------------------------------------------------------- | ----------------------------------------------- |
| PDF.js viewer code and worker, Mozilla Foundation                                | `pdfjs-dist`                   | Apache License 2.0                                                    | `pdfjs-dist.LICENSE.txt`                        |
| DM Sans font files, DM Sans Project Authors                                      | `@fontsource-variable/dm-sans` | SIL Open Font License 1.1                                             | `dm-sans.LICENSE.txt`                           |
| Manrope font files, Manrope Project Authors                                      | `@fontsource-variable/manrope` | SIL Open Font License 1.1                                             | `manrope.LICENSE.txt`                           |
| Lucide icons, Lucide Icons and Contributors; inherited Feather icons, Cole Bemis | `lucide-react`                 | ISC; MIT for the Feather-derived icons listed in the upstream license | `lucide-react.LICENSE.txt`                      |
| Internationalization code, Jan Amann                                             | `next-intl`, `use-intl`        | MIT                                                                   | `next-intl.LICENSE.txt`, `use-intl.LICENSE.txt` |

Fontsource's CSS imports emit the fonts into Next.js static assets. Lucide icons are compiled into the application. The asset-copy script also preserves a separate package-root `NOTICE`, if provided by a pinned upstream release.

The PDF.js worker and its additional rendering resources are served from `public/pdfjs/<pdfjs-dist version>/`, using the exact installed package version. The following upstream files are copied without modifications, together with their complete notices in the same directories:

| Rendering resource                                                                                               | Copied license files                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Adobe CMaps (`cmaps/`)                                                                                           | `cmaps/LICENSE` (Adobe's BSD-style notice)                                                                                                                                     |
| Foxit Symbol and Dingbats fonts only (`standard_fonts/FoxitSymbol.pfb`, `FoxitDingbats.pfb`)                     | `standard_fonts/LICENSE_FOXIT` (PDFium BSD-style notice)                                                                                                                       |
| JBIG2/CCITT and OpenJPEG WebAssembly decoders, their JavaScript fallbacks, and QCMS WebAssembly color conversion | `wasm/LICENSE_JBIG2`, `LICENSE_OPENJPEG`, `LICENSE_QCMS`, `LICENSE_PDFJS_JBIG2`, `LICENSE_PDFJS_OPENJPEG`, `LICENSE_PDFJS_QCMS` (the upstream BSD, MIT and Apache 2.0 notices) |
| ICC color profile (`iccs/`)                                                                                      | `iccs/LICENSE` (CC0 1.0)                                                                                                                                                       |

Other non-embedded fonts use browser/system substitution. Liberation font files and the unused QuickJS PDF scripting engine are not copied into the public assets.

## Native preview image

The preview service does not distribute the application fonts, PDF.js worker, or Lucide icons. Its `server.mjs` bundles the following packages; their complete upstream copyright and license texts are copied into `/app/licenses/` in the preview image:

| Package                       | License      | Image license file      |
| ----------------------------- | ------------ | ----------------------- |
| `dotenv`                      | BSD 2-Clause | `dotenv.LICENSE.txt`    |
| `parse5`                      | MIT          | `parse5.LICENSE.txt`    |
| `entities` (used by `parse5`) | BSD 2-Clause | `entities.LICENSE.txt`  |
| `ipaddr.js`                   | MIT          | `ipaddr.js.LICENSE.txt` |

The exact versions and transitive dependency graph are recorded in `package-lock.json`. The tables describe the separately copied asset and preview-bundle notices; they are not a complete inventory of every application or container dependency. Consult each installed package and the base image's notices for those components.

Repère is independent of Markup.io and Ceros. Their names are used only to describe the product use case. No logos, proprietary interface assets or source code have been copied.
