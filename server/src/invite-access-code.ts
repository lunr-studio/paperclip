import { createHash, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { invites } from "@paperclipai/db";

const DEFAULT_COLLABORATOR_ACCESS_CODE = "02143";
const COLLABORATOR_ACCESS_CODE_PROMPT =
  "Enter the collaborator access code to continue.";

type InviteAccessCodeAware = Pick<
  typeof invites.$inferSelect,
  "inviteType" | "allowedJoinTypes" | "expiresAt" | "revokedAt"
>;

function secureStringEquals(left: string, right: string) {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

export function hashInviteToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function getConfiguredCollaboratorAccessCode() {
  const envValue = process.env.PAPERCLIP_COLLABORATOR_ACCESS_CODE?.trim();
  return envValue && envValue.length > 0
    ? envValue
    : DEFAULT_COLLABORATOR_ACCESS_CODE;
}

export function inviteRequiresCollaboratorAccessCode(
  invite: InviteAccessCodeAware
) {
  return (
    invite.inviteType === "company_join" &&
    invite.allowedJoinTypes !== "agent" &&
    getConfiguredCollaboratorAccessCode().length > 0
  );
}

export function getInviteAccessCodePrompt(invite: InviteAccessCodeAware) {
  return inviteRequiresCollaboratorAccessCode(invite)
    ? COLLABORATOR_ACCESS_CODE_PROMPT
    : null;
}

export function validateInviteCollaboratorAccessCode(
  invite: InviteAccessCodeAware,
  candidate: string | null | undefined
) {
  if (!inviteRequiresCollaboratorAccessCode(invite)) return true;
  const normalizedCandidate = candidate?.trim() ?? "";
  return secureStringEquals(
    getConfiguredCollaboratorAccessCode(),
    normalizedCandidate
  );
}

export function inviteUnavailable(invite: InviteAccessCodeAware) {
  return Boolean(invite.revokedAt) || invite.expiresAt.getTime() <= Date.now();
}

export async function findInviteByToken(db: Db, token: string) {
  return db
    .select()
    .from(invites)
    .where(eq(invites.tokenHash, hashInviteToken(token)))
    .then((rows) => rows[0] ?? null);
}
