export function checkServices(options?: {
  appUrl?: string;
  appPort?: number;
  previewPort?: number;
  gatewayPort?: number;
  timeoutMs?: number;
}): Promise<void>;
