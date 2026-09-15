import { createHash } from "node:crypto";
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { expect, test } from "vitest";

test("setup runs without installed packages and preserves an environment containing empty values", () => {
  const root = mkdtempSync(path.join(tmpdir(), "repere-setup-test-"));
  try {
    mkdirSync(path.join(root, "scripts"));
    copyFileSync("scripts/setup.mjs", path.join(root, "scripts/setup.mjs"));
    const run = () =>
      spawnSync(process.execPath, ["scripts/setup.mjs", "--env-only"], {
        cwd: root,
        encoding: "utf8",
      });
    const fingerprint = () =>
      createHash("sha256")
        .update(readFileSync(path.join(root, ".env")))
        .digest("hex");
    const first = run();
    expect(first.status, first.stderr).toBe(0);
    const initial = fingerprint();
    const second = run();
    expect(second.status, second.stderr).toBe(0);
    expect(fingerprint()).toBe(initial);
    if (process.platform !== "win32")
      expect(statSync(path.join(root, ".env")).mode & 0o777).toBe(0o600);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
