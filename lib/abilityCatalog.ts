import fs from "node:fs";
import path from "node:path";

type AbilityMeta = {
  id: number;
  name: string | null;
  iconSrc: string | null;
};

const abilityById = new Map<number, AbilityMeta>();
let hydrated = false;

function strOrNull(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function abilityIconFromNode(node: any) {
  return (
    strOrNull(node?.image_webp) ??
    strOrNull(node?.image) ??
    strOrNull(node?.shop_image_webp) ??
    strOrNull(node?.shop_image) ??
    strOrNull(node?.icon) ??
    null
  );
}

function absorbAbilityNode(node: any) {
  const id = Number(node?.id ?? NaN);
  if (!Number.isFinite(id)) return;
  if (String(node?.type ?? "") !== "ability") return;

  const existing = abilityById.get(id);
  const next: AbilityMeta = {
    id,
    name: strOrNull(node?.name) ?? existing?.name ?? null,
    iconSrc: abilityIconFromNode(node) ?? existing?.iconSrc ?? null,
  };

  abilityById.set(id, next);
}

function walkAndCollect(root: unknown) {
  const stack: unknown[] = [root];

  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== "object") continue;

    if (Array.isArray(current)) {
      for (const entry of current) stack.push(entry);
      continue;
    }

    absorbAbilityNode(current as any);

    for (const value of Object.values(current as Record<string, unknown>)) {
      if (value && typeof value === "object") stack.push(value);
    }
  }
}

function hydrate() {
  if (hydrated) return;
  hydrated = true;

  const candidates = [
    path.join(process.cwd(), "response (3).json"),
    path.join(process.cwd(), "hero_data.json"),
  ];

  for (const filePath of candidates) {
    try {
      if (!fs.existsSync(filePath)) continue;
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      walkAndCollect(parsed);
    } catch {
      // Best-effort catalog hydration; leave map partially filled if parsing fails.
    }
  }
}

export function getAbilityMeta(abilityId: number | null | undefined): AbilityMeta | null {
  if (typeof abilityId !== "number" || !Number.isFinite(abilityId)) return null;
  hydrate();
  return abilityById.get(abilityId) ?? null;
}
