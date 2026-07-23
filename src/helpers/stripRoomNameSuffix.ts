// Room names in OfficeRnD carry a parenthetical capacity suffix for staff,
// e.g. "Boardroom (10-12 ppl)". Strip the trailing "(...)" — and the space
// in front of it — so lobby screens show just the room name.
export const stripRoomNameSuffix = (name: string): string =>
  name.replace(/\s*\([^)]*\)\s*$/, '');
