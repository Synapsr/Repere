import { readFile, readdir } from "node:fs/promises";
import { createTranslator } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

const root = new URL("../../src/i18n/messages/", import.meta.url);

async function catalog(locale: string, file: string): Promise<Record<string, string>> {
  return JSON.parse(await readFile(new URL(`${locale}/${file}`, root), "utf8"));
}

function parameters(message: string) {
  return [...new Set(message.match(/\{[a-zA-Z]\w*(?=[,}])|<[a-zA-Z]\w*>/g) ?? [])].sort();
}

describe("English and French application translations", () => {
  it("ships the same namespaces, keys and interpolation parameters in both languages", async () => {
    const englishFiles = (await readdir(new URL("en/", root))).sort();
    expect((await readdir(new URL("fr/", root))).sort()).toEqual(englishFiles);
    for (const file of englishFiles) {
      const [en, fr] = await Promise.all([catalog("en", file), catalog("fr", file)]);
      expect(Object.keys(fr).sort(), file).toEqual(Object.keys(en).sort());
      for (const key of Object.keys(en)) {
        expect(fr[key].trim(), `${file}:${key}`).not.toBe("");
        expect(parameters(fr[key]), `${file}:${key}`).toEqual(parameters(en[key]));
      }
    }
  });

  it("renders every message, including rich email addresses and zero/one/many plurals", async () => {
    for (const locale of ["en", "fr"] as const) {
      for (const file of await readdir(new URL(`${locale}/`, root))) {
        const messages = await catalog(locale, file);
        const t = createTranslator({
          locale,
          messages,
          onError(error) {
            throw new Error(`${locale}/${file}: ${error.message}`, { cause: error });
          },
        });
        for (const count of [0, 1, 2]) {
          for (const key of Object.keys(messages)) {
            const result = t.rich(key, {
              count,
              number: 2,
              minutes: 10,
              name: "Alex",
              inviter: "Camille",
              workspace: "Studio Alma",
              date: "23 September",
              email: "alex@example.test",
              code: "123456",
              address: (chunks: ReactNode) => chunks,
            });
            expect(result, `${locale}/${file}:${key}`).toBeTruthy();
          }
        }
      }
    }
  });
});
