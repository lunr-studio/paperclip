import { lookup as dnsLookup } from "node:dns/promises";
import type { IncomingMessage, RequestOptions as HttpRequestOptions } from "node:http";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

const DNS_LOOKUP_TIMEOUT_MS = 5_000;
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
const REACHABLE_HTTP_STATUSES = new Set([200, 201, 202, 204, 401, 403, 404, 405, 422, 500, 501]);
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata",
  "metadata.google.internal",
]);

export type InviteResolutionProbe = {
  status: "reachable" | "timeout" | "unreachable";
  method: "HEAD";
  durationMs: number;
  httpStatus: number | null;
  message: string;
};

export type InviteResolutionTargetErrorCode =
  | "invalid_url"
  | "disallowed_protocol"
  | "blocked_hostname"
  | "blocked_ip";

export class InviteResolutionTargetError extends Error {
  readonly code: InviteResolutionTargetErrorCode;
  readonly hostname: string | null;

  constructor(
    code: InviteResolutionTargetErrorCode,
    message: string,
    opts?: { hostname?: string | null }
  ) {
    super(message);
    this.name = "InviteResolutionTargetError";
    this.code = code;
    this.hostname = opts?.hostname ?? null;
  }
}

type ValidatedInviteResolutionTarget = {
  requestedUrl: URL;
  resolvedAddress: string;
  hostHeader: string;
  tlsServername?: string;
  useTls: boolean;
};

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function normalizeHostname(hostname: string) {
  return hostname.trim().toLowerCase().replace(/\.$/, "");
}

function isBlockedHostname(hostname: string) {
  const normalized = normalizeHostname(hostname);
  return (
    BLOCKED_HOSTNAMES.has(normalized) ||
    normalized.endsWith(".localhost")
  );
}

export function isPrivateOrReservedIp(ip: string): boolean {
  const lower = ip.toLowerCase();
  const v4MappedMatch = lower.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (v4MappedMatch?.[1]) return isPrivateOrReservedIp(v4MappedMatch[1]);

  if (ip.startsWith("10.")) return true;
  if (ip.startsWith("127.")) return true;
  if (ip.startsWith("169.254.")) return true;
  if (ip.startsWith("192.168.")) return true;
  if (ip.startsWith("172.")) {
    const second = Number.parseInt(ip.split(".")[1] ?? "", 10);
    if (second >= 16 && second <= 31) return true;
  }
  if (ip.startsWith("100.")) {
    const second = Number.parseInt(ip.split(".")[1] ?? "", 10);
    if (second >= 64 && second <= 127) return true;
  }
  if (ip.startsWith("198.")) {
    const second = Number.parseInt(ip.split(".")[1] ?? "", 10);
    if (second === 18 || second === 19) return true;
  }
  if (ip === "0.0.0.0") return true;

  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  if (/^fe[89ab]/.test(lower)) return true;

  return false;
}

function buildPinnedRequestOptions(target: ValidatedInviteResolutionTarget): HttpRequestOptions & { servername?: string } {
  return {
    protocol: target.requestedUrl.protocol,
    host: target.resolvedAddress,
    port: target.requestedUrl.port
      ? Number(target.requestedUrl.port)
      : target.useTls
        ? 443
        : 80,
    path: `${target.requestedUrl.pathname}${target.requestedUrl.search}`,
    method: "HEAD",
    headers: {
      Host: target.hostHeader,
    },
    auth:
      target.requestedUrl.username || target.requestedUrl.password
        ? `${decodeURIComponent(target.requestedUrl.username)}:${decodeURIComponent(
            target.requestedUrl.password
          )}`
        : undefined,
    servername: target.tlsServername,
  };
}

export async function resolveInviteResolutionTarget(
  urlString: string
): Promise<ValidatedInviteResolutionTarget> {
  let requestedUrl: URL;
  try {
    requestedUrl = new URL(urlString);
  } catch {
    throw new InviteResolutionTargetError(
      "invalid_url",
      "url must be an absolute http(s) URL"
    );
  }

  if (!ALLOWED_PROTOCOLS.has(requestedUrl.protocol)) {
    throw new InviteResolutionTargetError(
      "disallowed_protocol",
      "url must use http or https",
      { hostname: requestedUrl.hostname }
    );
  }

  const originalHostname = requestedUrl.hostname.replace(/^\[|\]$/g, "");
  if (isBlockedHostname(originalHostname)) {
    throw new InviteResolutionTargetError(
      "blocked_hostname",
      "url resolves to a loopback or metadata hostname and cannot be tested from the server",
      { hostname: originalHostname }
    );
  }

  const directIp = isIP(originalHostname);
  if (directIp !== 0) {
    if (isPrivateOrReservedIp(originalHostname)) {
      throw new InviteResolutionTargetError(
        "blocked_ip",
        "url resolves to a private or reserved address and cannot be tested from the server",
        { hostname: originalHostname }
      );
    }
    return {
      requestedUrl,
      resolvedAddress: originalHostname,
      hostHeader: requestedUrl.host,
      tlsServername: undefined,
      useTls: requestedUrl.protocol === "https:",
    };
  }

  const lookupStartedAt = Date.now();
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(
      () => reject(new Error(`DNS lookup timed out after ${DNS_LOOKUP_TIMEOUT_MS}ms`)),
      DNS_LOOKUP_TIMEOUT_MS
    );
  });

  let results: Awaited<ReturnType<typeof dnsLookup>>;
  try {
    results = await Promise.race([
      dnsLookup(originalHostname, { all: true, verbatim: true }),
      timeoutPromise,
    ]);
  } catch (error) {
    const durationMs = Date.now() - lookupStartedAt;
    throw new Error(
      `DNS resolution failed for ${originalHostname} after ${durationMs}ms: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  if (results.length === 0) {
    const durationMs = Date.now() - lookupStartedAt;
    throw new Error(
      `DNS resolution returned no results for ${originalHostname} after ${durationMs}ms`
    );
  }

  const safeResults = results.filter(
    (entry) => !isPrivateOrReservedIp(entry.address)
  );
  if (safeResults.length === 0) {
    throw new InviteResolutionTargetError(
      "blocked_ip",
      "url resolves to a private or reserved address and cannot be tested from the server",
      { hostname: originalHostname }
    );
  }

  const resolvedAddress = safeResults[0]!.address;
  return {
    requestedUrl,
    resolvedAddress,
    hostHeader: requestedUrl.host,
    tlsServername:
      requestedUrl.protocol === "https:" ? originalHostname : undefined,
    useTls: requestedUrl.protocol === "https:",
  };
}

export async function probeInviteResolutionUrl(
  urlString: string,
  timeoutMs: number
): Promise<{ requestedUrl: string; probe: InviteResolutionProbe }> {
  const validationStartedAt = Date.now();
  let target: ValidatedInviteResolutionTarget;
  try {
    target = await resolveInviteResolutionTarget(urlString);
  } catch (error) {
    if (error instanceof InviteResolutionTargetError) {
      throw error;
    }

    let requestedUrl = urlString;
    try {
      requestedUrl = new URL(urlString).toString();
    } catch {
      // Leave the raw string unchanged; invalid URL cases are already handled
      // above via InviteResolutionTargetError.
    }

    return {
      requestedUrl,
      probe: {
        status: "unreachable",
        method: "HEAD",
        durationMs: Date.now() - validationStartedAt,
        httpStatus: null,
        message:
          error instanceof Error
            ? error.message
            : "DNS resolution failed for the requested target.",
      },
    };
  }

  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const options = buildPinnedRequestOptions(target);
    const requestFn = target.useTls ? httpsRequest : httpRequest;

    const response = await new Promise<IncomingMessage>((resolve, reject) => {
      const req = requestFn({ ...options, signal: controller.signal }, resolve);
      req.on("error", reject);
      req.end();
    });

    response.resume();
    await new Promise<void>((resolve, reject) => {
      response.on("end", resolve);
      response.on("error", reject);
    });

    const durationMs = Date.now() - startedAt;
    const statusCode = response.statusCode ?? null;
    if (statusCode !== null && REACHABLE_HTTP_STATUSES.has(statusCode)) {
      return {
        requestedUrl: target.requestedUrl.toString(),
        probe: {
          status: "reachable",
          method: "HEAD",
          durationMs,
          httpStatus: statusCode,
          message: `Webhook endpoint responded to HEAD with HTTP ${statusCode}.`,
        },
      };
    }

    return {
      requestedUrl: target.requestedUrl.toString(),
      probe: {
        status: "unreachable",
        method: "HEAD",
        durationMs,
        httpStatus: statusCode,
        message:
          statusCode === null
            ? "Webhook endpoint probe completed without an HTTP status."
            : `Webhook endpoint probe returned HTTP ${statusCode}.`,
      },
    };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    if (isAbortError(error)) {
      return {
        requestedUrl: target.requestedUrl.toString(),
        probe: {
          status: "timeout",
          method: "HEAD",
          durationMs,
          httpStatus: null,
          message: `Webhook endpoint probe timed out after ${timeoutMs}ms.`,
        },
      };
    }

    return {
      requestedUrl: target.requestedUrl.toString(),
      probe: {
        status: "unreachable",
        method: "HEAD",
        durationMs,
        httpStatus: null,
        message: `Webhook endpoint probe failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}
