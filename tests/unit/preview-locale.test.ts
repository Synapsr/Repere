import { describe, expect, it } from "vitest";
import { previewLocale, previewPinLabel } from "../../preview/messages";

describe("preview locale updates", () => {
  it("keeps the active locale when an unsupported frame message or stored value is supplied", () => {
    for (const invalid of [undefined, null, "FR", "de", {}, "</script>"])
      expect(previewLocale(invalid, "fr")).toBe("fr");
    expect(previewLocale("en", "fr")).toBe("en");
    expect(previewLocale("fr", "en")).toBe("fr");
  });
  it("updates pin accessibility labels while preserving the comment number and approximate state", () => {
    expect(previewPinLabel("fr", 12)).toBe("Retour 12");
    expect(previewPinLabel("en", 12)).toBe("Comment 12");
    expect(previewPinLabel("fr", 12, true)).toBe("Retour 12 · Position approximative");
    expect(previewPinLabel("en", 12, true)).toBe("Comment 12 · Approximate position");
  });
});
