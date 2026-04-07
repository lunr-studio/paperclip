import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { accessRoutes } from "../routes/access.js";
import { errorHandler } from "../middleware/index.js";

const mockAccessService = vi.hoisted(() => ({
  isInstanceAdmin: vi.fn(),
  hasPermission: vi.fn(),
  canUser: vi.fn(),
  getMembership: vi.fn(),
  ensureMembership: vi.fn(),
  listMembers: vi.fn(),
  setMemberPermissions: vi.fn(),
  promoteInstanceAdmin: vi.fn(),
  demoteInstanceAdmin: vi.fn(),
  listUserCompanyAccess: vi.fn(),
  listInstanceUsers: vi.fn(),
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
  resolveBoardActivityCompanyIds: vi.fn(),
  assertCurrentBoardKey: vi.fn(),
  revokeBoardApiKey: vi.fn(),
}));

vi.mock("../services/index.js", () => ({
  accessService: () => mockAccessService,
  agentService: () => mockAgentService,
  boardAuthService: () => mockBoardAuthService,
  logActivity: vi.fn(),
  notifyHireApproved: vi.fn(),
  deduplicateAgentName: vi.fn((name: string) => name),
}));

function createApp(actor: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  app.use(
    "/api",
    accessRoutes({} as any, {
      deploymentMode: "authenticated",
      deploymentExposure: "private",
      bindHost: "127.0.0.1",
      allowedHostnames: [],
    }),
  );
  app.use(errorHandler);
  return app;
}

describe("admin users route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccessService.isInstanceAdmin.mockResolvedValue(true);
    mockAccessService.listInstanceUsers.mockResolvedValue([
      {
        id: "user-1",
        name: "Trishan",
        email: "trishan@lunr.studio",
        createdAt: new Date("2026-04-01T12:00:00.000Z"),
        isInstanceAdmin: true,
        companyAccess: [
          {
            companyId: "company-1",
            companyName: "Lunr Studio",
            companyIssuePrefix: "LUN",
            status: "active",
            membershipRole: "member",
            createdAt: new Date("2026-04-01T12:05:00.000Z"),
            updatedAt: new Date("2026-04-01T12:05:00.000Z"),
          },
        ],
      },
    ]);
  });

  it("allows instance admins to list signed-up users", async () => {
    const app = createApp({
      type: "board",
      userId: "admin-1",
      source: "session",
      isInstanceAdmin: true,
      companyIds: [],
    });

    const res = await request(app).get("/api/admin/users");

    expect(res.status).toBe(200);
    expect(mockAccessService.listInstanceUsers).toHaveBeenCalled();
    expect(res.body).toEqual([
      expect.objectContaining({
        id: "user-1",
        email: "trishan@lunr.studio",
        isInstanceAdmin: true,
      }),
    ]);
  });

  it("rejects non-admin board users", async () => {
    mockAccessService.isInstanceAdmin.mockResolvedValue(false);
    const app = createApp({
      type: "board",
      userId: "user-1",
      source: "session",
      isInstanceAdmin: false,
      companyIds: ["company-1"],
    });

    const res = await request(app).get("/api/admin/users");

    expect(res.status).toBe(403);
    expect(mockAccessService.listInstanceUsers).not.toHaveBeenCalled();
  });
});
