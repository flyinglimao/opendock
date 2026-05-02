// lib/telegram-token-store.ts
// In-memory store for short-lived Telegram registration tokens.
// No webhook needed: the verify endpoint polls Telegram's getUpdates API directly.
// TTL: 10 minutes.

const TOKEN_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface PendingEntry {
  userAddress: string; // lowercase wallet address
  expiresAt: number;   // epoch ms
}

// Map: token → pending entry
const pending = new Map<string, PendingEntry>();

// --- helpers ---

function sweep() {
  const now = Date.now();
  for (const [token, entry] of pending) {
    if (entry.expiresAt < now) pending.delete(token);
  }
}

/** Generate a cryptographically random hex token. */
function randomToken(): string {
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ---- Public API ----

/**
 * Create a new registration token for a wallet address.
 * Any previously-pending token for the same address is invalidated.
 */
export function createRegistrationToken(userAddress: string): {
  token: string;
  expiresAt: number;
} {
  sweep();
  // Invalidate any previous pending token for this address
  for (const [token, entry] of pending) {
    if (entry.userAddress === userAddress.toLowerCase()) {
      pending.delete(token);
    }
  }

  const token = randomToken();
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  pending.set(token, { userAddress: userAddress.toLowerCase(), expiresAt });
  return { token, expiresAt };
}

/**
 * Validate that a token belongs to the given address and hasn't expired.
 * Returns the entry if valid, null otherwise.
 * Does NOT remove it so the caller can retry.
 */
export function validatePendingToken(
  token: string,
  userAddress: string
): PendingEntry | null {
  sweep();
  const entry = pending.get(token);
  if (!entry) return null;
  if (entry.userAddress !== userAddress.toLowerCase()) return null;
  return entry;
}

/**
 * Consume (remove) a pending token after successful binding.
 */
export function consumeToken(token: string): void {
  pending.delete(token);
}
