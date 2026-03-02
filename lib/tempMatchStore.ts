type TempMatchPayload = {
  matchId: string;
  rawJson: any;
  createdAt: number;
};

const store = new Map<string, TempMatchPayload>();

export function setTempMatch(matchId: string, rawJson: any) {
  store.set(matchId, {
    matchId,
    rawJson,
    createdAt: Date.now(),
  });
}

export function getTempMatch(matchId: string) {
  return store.get(matchId) ?? null;
}

export function clearTempMatch(matchId: string) {
  store.delete(matchId);
}