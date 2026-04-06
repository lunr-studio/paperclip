import { afterEach, describe, expect, it } from "vitest";
import {
  getConfiguredCollaboratorAccessCode,
  getInviteAccessCodePrompt,
  inviteRequiresCollaboratorAccessCode,
  validateInviteCollaboratorAccessCode,
} from "../invite-access-code.js";

const originalCollaboratorAccessCode =
  process.env.PAPERCLIP_COLLABORATOR_ACCESS_CODE;

const humanInvite = {
  inviteType: "company_join" as const,
  allowedJoinTypes: "both" as const,
  expiresAt: new Date("2099-03-07T00:10:00.000Z"),
  revokedAt: null,
};

describe("invite access code helpers", () => {
  afterEach(() => {
    if (originalCollaboratorAccessCode === undefined) {
      delete process.env.PAPERCLIP_COLLABORATOR_ACCESS_CODE;
    } else {
      process.env.PAPERCLIP_COLLABORATOR_ACCESS_CODE =
        originalCollaboratorAccessCode;
    }
  });

  it("defaults the collaborator access code to 02143", () => {
    expect(getConfiguredCollaboratorAccessCode()).toBe("02143");
    expect(inviteRequiresCollaboratorAccessCode(humanInvite)).toBe(true);
    expect(getInviteAccessCodePrompt(humanInvite)).toContain("access code");
    expect(validateInviteCollaboratorAccessCode(humanInvite, "02143")).toBe(true);
    expect(validateInviteCollaboratorAccessCode(humanInvite, "99999")).toBe(false);
  });

  it("allows the collaborator access code to be overridden via env", () => {
    process.env.PAPERCLIP_COLLABORATOR_ACCESS_CODE = "31415";

    expect(getConfiguredCollaboratorAccessCode()).toBe("31415");
    expect(validateInviteCollaboratorAccessCode(humanInvite, "02143")).toBe(false);
    expect(validateInviteCollaboratorAccessCode(humanInvite, "31415")).toBe(true);
  });

  it("does not require an access code for bootstrap or agent-only invites", () => {
    expect(
      inviteRequiresCollaboratorAccessCode({
        ...humanInvite,
        inviteType: "bootstrap_ceo",
      }),
    ).toBe(false);
    expect(
      inviteRequiresCollaboratorAccessCode({
        ...humanInvite,
        allowedJoinTypes: "agent",
      }),
    ).toBe(false);
  });
});
