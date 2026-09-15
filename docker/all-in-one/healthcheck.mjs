import http from "node:http";
import { pathToFileURL } from "node:url";

function status(port, path, host, timeoutMs) {
  return new Promise((resolve, reject) => {
    // Node fetch can replace Host with the loopback URL's authority. A raw HTTP
    // request preserves the public Host required by the strict gateway router.
    const request = http.get(
      {
        hostname: "127.0.0.1",
        port,
        path,
        headers: host ? { Host: host } : {},
        agent: false,
      },
      (response) => {
        response.resume();
        response.once("end", () => resolve(response.statusCode));
        response.once("error", reject);
      },
    );
    const timeout = setTimeout(() => request.destroy(new Error("Service unavailable")), timeoutMs);
    request.once("close", () => clearTimeout(timeout));
    request.once("error", reject);
  });
}

export async function checkServices({
  appUrl = process.env.APP_URL ?? "http://localhost:8080",
  appPort = 3000,
  previewPort = 3001,
  gatewayPort = Number(process.env.PORT ?? 8080),
  timeoutMs = 5000,
} = {}) {
  const app = new URL(appUrl);
  const statuses = await Promise.all([
    status(appPort, "/api/health", undefined, timeoutMs),
    status(previewPort, "/health", undefined, timeoutMs),
    status(gatewayPort, "/api/health", app.host, timeoutMs),
  ]);
  if (statuses.some((code) => code < 200 || code >= 300)) throw new Error("Service unavailable");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await checkServices();
  } catch {
    // Health output must never contain configuration or connection credentials.
    process.exitCode = 1;
  }
}
