import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { chmod, chown, link, lstat, mkdir, open, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { RuntimeError } from "./config.mjs";

const keys = ["sessionSecret", "proxySecret", "mysqlPassword", "mysqlRootPassword"];

export async function ensureDirectory(directory, mode) {
  await mkdir(directory, { recursive: true, mode });
  if (!(await lstat(directory)).isDirectory())
    throw new RuntimeError("A persistent data path is not a directory.");
  await chmod(directory, mode);
}

async function readSecrets(file) {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 4096)
      throw new RuntimeError("The persisted secrets file is invalid; restore it from backup.");
    const value = JSON.parse(await handle.readFile("utf8"));
    if (
      !value ||
      value.version !== 1 ||
      keys.some((key) => !/^[a-f0-9]{64}$/.test(value[key] ?? ""))
    )
      throw new RuntimeError("The persisted secrets file is invalid; restore it from backup.");
    await handle.chmod(0o600);
    if (process.getuid?.() === 0) await handle.chown(0, 0);
    return value;
  } catch (error) {
    if (error instanceof RuntimeError) throw error;
    throw new RuntimeError("The persisted secrets file cannot be read; restore it from backup.");
  } finally {
    await handle.close();
  }
}

export async function loadOrCreateSecrets(dataDirectory = "/data") {
  await ensureDirectory(dataDirectory, 0o711);
  if (process.getuid?.() === 0) await chown(dataDirectory, 0, 0);
  const file = path.join(dataDirectory, "secrets.json");
  try {
    return await readSecrets(file);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  let databaseFiles = [];
  try {
    databaseFiles = await readdir(path.join(dataDirectory, "mysql"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (databaseFiles.length)
    throw new RuntimeError(
      "MySQL data exists without /data/secrets.json. Restore the matching secrets; existing data will not be reinitialized.",
    );
  const value = {
    version: 1,
    ...Object.fromEntries(keys.map((key) => [key, randomBytes(32).toString("hex")])),
  };
  const temporary = path.join(dataDirectory, `.secrets-${randomBytes(12).toString("hex")}.tmp`);
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    // A hard link publishes the complete file atomically and never overwrites another initializer.
    await link(temporary, file);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  } finally {
    await unlink(temporary);
  }
  return readSecrets(file);
}

export async function prepareServiceDirectories(dataDirectory = "/data") {
  const uploads = path.join(dataDirectory, "uploads");
  await ensureDirectory(uploads, 0o700);
  await chown(uploads, 1000, 1000);
  // The official MySQL entrypoint creates/chowns its datadir and socket directory for mysql.
  await ensureDirectory(path.join(dataDirectory, "mysql"), 0o700);
}
