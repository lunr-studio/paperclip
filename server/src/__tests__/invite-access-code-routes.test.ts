import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { companies, invites } from "@paperclipai/db";
import { accessRoutes } from "../routes/access.js";
import { errorHandler } from "../middleware/index.js";

const originalCollaboratorAccessCode =
  process.env.PAPERCLIP_COLLABORATOR_ACCESS_CODE;

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

const mockLogActivity = vi.hoisted(() => vi.fn());

vi.mock("../services/index.js", () => ({
  accessService: () => mockAccessService,
  agentService: () => mockAgentService,
  boardAuthService: () => mockBoardAuthService,
  deduplicateAgentName: vi.fn((name: string) => name),
  logActivity: mockLogActivity,
  notifyHireApproved: vi.fn(),
}));

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

function createApp(actor: Record<string, unknown>, db: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  app.use(
    "/api",
    accessRoutes(db as any, {
      deploymentMode: "authenticated",
      deploymentExposure: "public",
      bindHost: "0.0.0.0",
      allowedHostnames: ["paperclip.example.com"],
    }),
  );
  app.use(errorHandler);
  return app;
}

describe("invite access code routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    if (originalCollaboratorAccessCode === undefined) {
      delete process.env.PAPERCLIP_COLLABORATOR_ACCESS_CODE;
    } else {
      process.env.PAPERCLIP_COLLABORATOR_ACCESS_CODE =
        originalCollaboratorAccessCode;
    }
  });

  it("includes access code metadata in invite summaries for human joins", async () => {
    const app = createApp(
      {
        type: "board",
        userId: "user-1",
        companyIds: ["company-1"],
        source: "session",
        isInstanceAdmin: false,
      },
      createDbStub(),
    );

    const res = await request(app).get("/api/invites/pcp_invite_test");

    expect(res.status).toBe(200);
    expect(res.body.requiresAccessCode).toBe(true);
    expect(res.body.accessCodePrompt).toContain("access code");
  });

  it("rejects human invite acceptance when the collaborator access code is wrong", async () => {
    const app = createApp(
      {
        type: "board",
        userId: "user-1",
        companyIds: ["company-1"],
        source: "session",
        isInstanceAdmin: false,
      },
      createDbStub(),
    );

    const res = await request(app)
      .post("/api/invites/pcp_invite_test/accept")
      .send({ requestType: "human", accessCode: "99999" });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("access code");
  });
});
