import type { Request } from "express";

function normalizeProtocol(value: string | undefined): "http" | "https" | null {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "http" || normalized === "https") return normalized;
  return null;
}

export function extractRequestHostHeader(req: Request): string | null {
  const raw = req.header("host")?.trim();
  if (!raw) return null;
  return raw;
}

export function extractRequestHostname(req: Request): string | null {
  const host = extractRequestHostHeader(req);
  if (!host) return null;

  try {
    return new URL(`http://${host}`).hostname.trim().toLowerCase();
  } catch {
    return host.trim().toLowerCase();
  }
}

export function requestBaseUrl(req: Request): string {
  const forwardedProto = normalizeProtocol(
    req.header("x-forwarded-proto")?.split(",")[0],
  );
  const protocol = forwardedProto ?? normalizeProtocol(req.protocol) ?? "http";
  const host = extractRequestHostHeader(req);
  if (!host) return "";
  return `${protocol}://${host}`;
}
