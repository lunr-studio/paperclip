import { beforeEach, describe, expect, it, vi } from "vitest";

const mockLookup = vi.hoisted(() => vi.fn());

vi.mock("node:dns/promises", () => ({
  lookup: mockLookup,
}));

import {
  InviteResolutionTargetError,
  isPrivateOrReservedIp,
  probeInviteResolutionUrl,
  resolveInviteResolutionTarget,
} from "../invite-resolution-probe.js";

describe("invite resolution probe target validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("classifies private and reserved IPs", () => {
    expect(isPrivateOrReservedIp("10.0.0.7")).toBe(true);
    expect(isPrivateOrReservedIp("169.254.169.254")).toBe(true);
    expect(isPrivateOrReservedIp("fd00::1")).toBe(true);
    expect(isPrivateOrReservedIp("8.8.8.8")).toBe(false);
  });

  it("rejects loopback hostnames before DNS lookup", async () => {
    await expect(
      resolveInviteResolutionTarget("http://localhost:3100/health")
    ).rejects.toMatchObject<Partial<InviteResolutionTargetError>>({
      code: "blocked_hostname",
    });
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it("rejects private IP literals", async () => {
    await expect(
      resolveInviteResolutionTarget("http://10.1.2.3:3100/health")
    ).rejects.toMatchObject<Partial<InviteResolutionTargetError>>({
      code: "blocked_ip",
    });
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it("rejects hostnames that resolve only to private or metadata IPs", async () => {
    mockLookup.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);

    await expect(
      resolveInviteResolutionTarget("https://metadata.google.internal/compute")
    ).rejects.toMatchObject<Partial<InviteResolutionTargetError>>({
      code: "blocked_hostname",
    });

    await expect(
      resolveInviteResolutionTarget("https://gateway.example.test")
    ).rejects.toMatchObject<Partial<InviteResolutionTargetError>>({
      code: "blocked_ip",
    });
  });

  it("accepts hostnames with at least one public DNS result and pins a safe address", async () => {
    mockLookup.mockResolvedValue([
      { address: "10.0.0.5", family: 4 },
      { address: "203.0.113.10", family: 4 },
    ]);

    const result = await resolveInviteResolutionTarget(
      "https://gateway.example.test:8443/webhook?foo=bar"
    );

    expect(result.resolvedAddress).toBe("203.0.113.10");
    expect(result.hostHeader).toBe("gateway.example.test:8443");
    expect(result.tlsServername).toBe("gateway.example.test");
    expect(result.requestedUrl.toString()).toBe(
      "https://gateway.example.test:8443/webhook?foo=bar"
    );
  });

  it("reports DNS lookup failures as unreachable probe results", async () => {
    mockLookup.mockRejectedValue(new Error("getaddrinfo ENOTFOUND gateway.example.test"));

    const result = await probeInviteResolutionUrl(
      "https://gateway.example.test/webhook",
      5000
    );

    expect(result.requestedUrl).toBe("https://gateway.example.test/webhook");
    expect(result.probe.status).toBe("unreachable");
    expect(result.probe.httpStatus).toBeNull();
    expect(result.probe.message).toContain("DNS resolution failed");
  });
});
