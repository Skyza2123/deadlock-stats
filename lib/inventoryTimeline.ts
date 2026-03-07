export type InventoryEventLike = {
  gameTimeS: number;
  itemId: number;
  soldTimeS?: number | null;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isItemActiveAtTime(event: InventoryEventLike, timeS: number) {
  if (!isFiniteNumber(event.gameTimeS) || !isFiniteNumber(timeS)) return false;
  if (event.gameTimeS > timeS) return false;

  const soldTimeS = event.soldTimeS;
  if (!isFiniteNumber(soldTimeS) || soldTimeS <= 0) {
    return true;
  }

  return soldTimeS > timeS;
}

export function resolveLiveInventoryEvents<T extends InventoryEventLike>(
  inventoryEvents: T[],
  timeS: number
): T[] {
  const activeEvents = inventoryEvents.filter((itemEvent) => isItemActiveAtTime(itemEvent, timeS));

  const latestByItemId = new Map<number, T>();
  for (const itemEvent of activeEvents) {
    const existing = latestByItemId.get(itemEvent.itemId);
    if (!existing || existing.gameTimeS <= itemEvent.gameTimeS) {
      latestByItemId.set(itemEvent.itemId, itemEvent);
    }
  }

  return [...latestByItemId.values()].sort((a, b) => a.gameTimeS - b.gameTimeS);
}

export function resolveInventorySlotsAtTime<T extends InventoryEventLike>(
  inventoryEvents: T[],
  timeS: number,
  slotCount = 12
): Array<T | null> {
  const liveItems = resolveLiveInventoryEvents(inventoryEvents, timeS);
  const visibleItems = liveItems.slice(-slotCount);
  const slots: Array<T | null> = Array.from({ length: slotCount }, () => null);
  const offset = Math.max(0, slotCount - visibleItems.length);

  for (let index = 0; index < visibleItems.length; index += 1) {
    slots[offset + index] = visibleItems[index];
  }

  return slots;
}