const STORAGE_PREFIX = "paperclip:invite-access-code:";

export function extractInviteTokenFromNextPath(nextPath: string): string | null {
  const match = nextPath.match(/^\/invite\/([^/?#]+)/);
  return match?.[1]?.trim() || null;
}

function storageKey(token: string) {
  return `${STORAGE_PREFIX}${token}`;
}

export function readStoredInviteAccessCode(token: string): string {
  if (!token) return "";
  try {
    return sessionStorage.getItem(storageKey(token)) ?? "";
  } catch {
    return "";
  }
}

export function writeStoredInviteAccessCode(token: string, value: string) {
  if (!token) return;
  try {
    const normalized = value.trim();
    if (normalized) {
      sessionStorage.setItem(storageKey(token), normalized);
    } else {
      sessionStorage.removeItem(storageKey(token));
    }
  } catch {
    // Ignore storage failures.
  }
}

export function clearStoredInviteAccessCode(token: string) {
  if (!token) return;
  try {
    sessionStorage.removeItem(storageKey(token));
  } catch {
    // Ignore storage failures.
  }
}
