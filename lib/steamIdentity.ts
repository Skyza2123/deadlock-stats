const STEAM_ID64_BASE = BigInt("76561197960265728");

function cleanNumericId(value: string) {
  const trimmed = value.trim();
  return /^\d+$/.test(trimmed) ? trimmed : "";
}

export function steamId64ToAccountId(steamId: string) {
  const numeric = cleanNumericId(steamId);
  if (!numeric) return "";

  try {
    const value = BigInt(numeric);
    if (value <= STEAM_ID64_BASE) return "";
    return String(value - STEAM_ID64_BASE);
  } catch {
    return "";
  }
}

export function steamAccountIdToSteamId64(accountId: string) {
  const numeric = cleanNumericId(accountId);
  if (!numeric) return "";

  try {
    return String(BigInt(numeric) + STEAM_ID64_BASE);
  } catch {
    return "";
  }
}

export function steamIdVariants(steamId: string) {
  const variants = new Set<string>();
  const raw = cleanNumericId(steamId);
  if (!raw) return [];

  variants.add(raw);

  const accountId = steamId64ToAccountId(raw);
  if (accountId) variants.add(accountId);

  if (!accountId) {
    const steamId64 = steamAccountIdToSteamId64(raw);
    if (steamId64) variants.add(steamId64);
  }

  return [...variants];
}

export function membershipKeysFromUserId(userId: string | null | undefined) {
  const rawUserId = String(userId ?? "").trim();
  if (!rawUserId) return [];

  if (rawUserId.startsWith("steam:")) {
    return steamIdVariants(rawUserId.slice(6));
  }

  if (rawUserId.startsWith("user:")) {
    const key = rawUserId.slice(5).trim();
    return key ? [key] : [];
  }

  if (rawUserId.includes(":")) return [];
  return rawUserId ? [rawUserId] : [];
}

export function primaryMembershipKeyFromUserId(userId: string | null | undefined) {
  const rawUserId = String(userId ?? "").trim();
  if (rawUserId.startsWith("steam:")) {
    const rawSteamId = rawUserId.slice(6).trim();
    return steamId64ToAccountId(rawSteamId) || rawSteamId;
  }

  return membershipKeysFromUserId(rawUserId)[0] ?? "";
}

export function playerIdDisplayPair(playerId: string) {
  const raw = cleanNumericId(playerId);
  if (!raw) return { deadlockId: String(playerId ?? "").trim(), steamId64: "" };

  const deadlockId = steamId64ToAccountId(raw);
  if (deadlockId) {
    return { deadlockId, steamId64: raw };
  }

  return {
    deadlockId: raw,
    steamId64: steamAccountIdToSteamId64(raw),
  };
}
