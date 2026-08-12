const PHYSICAL_ITEM_TYPES = new Set([
  "armor",
  "backpack",
  "consumable",
  "equipment",
  "shield",
  "treasure",
  "weapon"
]);

function itemList(actor) {
  const items = actor?.items;
  if (!items) return [];
  if (Array.isArray(items)) return items;
  if (Array.isArray(items.contents)) return items.contents;
  try { return Array.from(items); } catch { return []; }
}

function sourceDescription(item) {
  return item?._source?.system?.description ?? item?.system?.description;
}

/**
 * PF2e 8.x physical items expect system.description during data preparation.
 * Older/custom malformed items can lack that object entirely. Any later
 * embedded-item mutation then forces a full Actor reset and makes PF2e fail in
 * PhysicalItem#getMystifiedData before Aura Forge's new Effect can finish.
 *
 * The repair is intentionally narrow: only PF2e physical item types with a
 * completely missing description object are normalized, and no user-authored
 * description content is touched.
 */
export function malformedPhysicalDescriptionItems(actor) {
  return itemList(actor).filter((item) =>
    PHYSICAL_ITEM_TYPES.has(String(item?.type ?? ""))
    && sourceDescription(item) == null
    && item?.id
  );
}

export async function repairMalformedPhysicalDescriptions(actor, { logger = console } = {}) {
  if (!actor || typeof actor.updateEmbeddedDocuments !== "function") {
    return { repaired: 0, itemIds: [] };
  }

  const malformed = malformedPhysicalDescriptionItems(actor);
  if (malformed.length === 0) return { repaired: 0, itemIds: [] };

  const updates = malformed.map((item) => ({
    _id: item.id,
    "system.description": { value: "", gm: "" }
  }));

  await actor.updateEmbeddedDocuments("Item", updates, { render: false });
  const itemIds = malformed.map((item) => item.id);
  logger?.warn?.(
    "pf2e-aura-forge | Repaired malformed PF2e physical item description data before applying an aura effect.",
    { actor: actor.uuid ?? actor.id, itemIds }
  );
  return { repaired: itemIds.length, itemIds };
}
