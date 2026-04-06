import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { companies, invites } from "@paperclipai/db";
import { accessRoutes } from "../routes/access.js";
import { errorHandler } from "../middleware/index.js";

const mockProbeInviteResolutionUrl = vi.hoisted(() => vi.fn());

const mockAccessService = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  canUser: vi.fn(),
  isInstanceAdmin: vi.fn(),
  getMembership: vi.fn(),
  ensureMembership: vi.fn(),
  listMembers: vi.fn(),
  setMemberPermissions: vi.fn(),
  promoteInstanceAdmin: vi.fn(),
  demoteInstanceAdmin: vi.fn(),
  listUserCompanyAccess: vi.fn(),
  setUserCompanyAccess: vi.fn(),
  setPrincipalGrants: vi.fn(),
}));

const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
}));

const mockBoardAuthService = vi.hoisted(() => ({
  createCliAuthChallenge: vi.fn(),
  describeCliAuthChallenge: vi.fn(),
  approveCliAuthChallenge: vi.fn(),
  cancelCliAuthChallenge: vi.fn(),
  resolveBoardAccess: vi.fn(),
  assertCurrentBoardKey: vi.fn(),
  revokeBoardApiKey: vi.fn(),
}));

vi.mock("../services/index.js", () => ({
  accessService: () => mockAccessService,
  agentService: () => mockAgentService,
  boardAuthService: () => mockBoardAuthService,
  deduplicateAgentName: vi.fn((name: string) => name),
  logActivity: vi.fn(),
  notifyHireApproved: vi.fn(),
}));

vi.mock("../invite-resolution-probe.js", async () => {
  const actual =
    await vi.importActual<typeof import("../invite-resolution-probe.js")>(
      "../invite-resolution-probe.js"
    );
  return {
    ...actual,
    probeInviteResolutionUrl: mockProbeInviteResolutionUrl,
  };
});

function createDbStub() {
  const inviteRow = {
    id: "invite-1",
    companyId: "company-1",
    inviteType: "company_join",
    allowedJoinTypes: "both",
    defaultsPayload: null,
    expiresAt: new Date("2099-03-07T00:10:00.000Z"),
    invitedByUserId: null,
    tokenHash: "hash",
    revokedAt: null,
    acceptedAt: null,
    createdAt: new Date("2099-03-07T00:00:00.000Z"),
    updatedAt: new Date("2099-03-07T00:00:00.000Z"),
  };

  const select = vi.fn(() => ({
    from(table: unknown) {
      return {
        where: vi.fn().mockImplementation(() => {
          if (table === invites) {
            return Promise.resolve([inviteRow]);
          }
          if (table === companies) {
            return Promise.resolve([{ name: "Lunr Studio" }]);
          }
          return Promise.resolve([]);
        }),
      };
    },
  }));

  return {
    select,
  };
}

function createApp(actor: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  app.use(
    "/api",
    accessRoutes(createDbStub() as any, {
      deploymentMode: "authenticated",
      deploymentExposure: "public",
      bindHost: "0.0.0.0",
      allowedHostnames: ["paperclip.example.com"],
    }),
  );
  app.use(errorHandler);
  return app;
}

describe("invite resolution test route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccessService.canUser.mockResolvedValue(true);
  });

  it("rejects non-board actors", async () => {
    const app = createApp({
      type: "agent",
      agentId: "agent-1",
      companyIds: ["company-1"],
      source: "agent_key",
    });

    const res = await request(app).get(
      "/api/invites/pcp_invite_test/test-resolution?url=https://gateway.example.test"
    );

    expect(res.status).toBe(401);
    expect(res.body.error).toContain("Board authentication");
    expect(mockProbeInviteResolutionUrl).not.toHaveBeenCalled();
  });

  it("requires users:invite permission for board sessions", async () => {
    mockAccessService.canUser.mockResolvedValue(false);
    const app = createApp({
      type: "board",
      userId: "user-1",
      companyIds: ["company-1"],
      source: "session",
      isInstanceAdmin: false,
    });

    const res = await request(app).get(
      "/api/invites/pcp_invite_test/test-resolution?url=https://gateway.example.test"
    );

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("Permission denied");
    expect(mockProbeInviteResolutionUrl).not.toHaveBeenCalled();
  });

  it("returns the probe result for authorized board users", async () => {
    mockProbeInviteResolutionUrl.mockResolvedValue({
      requestedUrl: "https://gateway.example.test/webhook",
      probe: {
        status: "reachable",
        method: "HEAD",
        durationMs: 42,
        httpStatus: 200,
        message: "Webhook endpoint responded to HEAD with HTTP 200.",
      },
    });
    const app = createApp({
      type: "board",
      userId: "user-1",
      companyIds: ["company-1"],
      source: "session",
      isInstanceAdmin: false,
    });

    const res = await request(app).get(
      "/api/invites/pcp_invite_test/test-resolution?url=https://gateway.example.test/webhook"
    );

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("reachable");
    expect(res.body.httpStatus).toBe(200);
    expect(mockProbeInviteResolutionUrl).toHaveBeenCalledWith(
      "https://gateway.example.test/webhook",
      5000
    );
  });
});
