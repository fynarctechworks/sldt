// Renders the human-readable room-type label for receipts, invoices and any
// other customer-facing surface. There are three cases:
//
//   1. No sold-as override → show the physical type's label
//      e.g. "Ac Single Bed Rooms"
//   2. Sold-as = same as physical → show the physical label (no point
//      repeating it).
//   3. Sold-as ≠ physical → show BOTH so the guest sees what they're
//      paying for and the staff knows what the room actually is:
//      "Ac Single Bed Rooms booked as Non Ac Bed Rooms"
//
// `slugToLabel` is a Map of room_types.slug → room_types.label produced
// from a single SELECT against the room_types table.
//
// `prettify` is the fallback when a slug isn't in the map (e.g. archived
// type that was deleted). It strips underscores and title-cases the slug.

export type RoomTypeLabelMap = Map<string, string>;

function prettify(slug: string): string {
  return slug
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function lookup(slug: string, map: RoomTypeLabelMap): string {
  return map.get(slug) ?? prettify(slug);
}

export function combinedRoomTypeLabel(
  physicalSlug: string,
  soldAsSlug: string | null | undefined,
  map: RoomTypeLabelMap,
): string {
  const physicalLabel = lookup(physicalSlug, map);
  if (!soldAsSlug || soldAsSlug === physicalSlug) return physicalLabel;
  const soldAsLabel = lookup(soldAsSlug, map);
  return `${physicalLabel} booked as ${soldAsLabel}`;
}
