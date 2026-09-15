import type { Server } from "node:http";

export function createGateway(options: {
  appUrl: string;
  previewBaseUrl: string;
  appPort?: number;
  previewPort?: number;
  trustProxy?: boolean;
  upstreamTimeoutMs?: number;
  maxConnections?: number;
}): { server: Server; close(): Promise<void> };
