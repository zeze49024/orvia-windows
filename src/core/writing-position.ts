import { vaultSession } from "./vault";
export type WritingPosition = {
  mode: "source" | "rich";
  rich: { from: number; to: number };
  source: { from: number; to: number; scroll: number };
  scroll: number;
};
const key = "orvia-writing-positions-v1";
const valid = (n: unknown) =>
  typeof n === "number" && Number.isFinite(n) && n >= 0;
export function readPosition(id: string): WritingPosition | undefined {
  try {
    if (vaultSession.active) return vaultSession.payload!.positions[id];
    const entry = JSON.parse(localStorage.getItem(key) ?? "{}")[id];
    if (
      entry &&
      ["source", "rich"].includes(entry.mode) &&
      [
        entry.rich?.from,
        entry.rich?.to,
        entry.source?.from,
        entry.source?.to,
        entry.source?.scroll,
        entry.scroll,
      ].every(valid) &&
      [
        entry.rich.from,
        entry.rich.to,
        entry.source.from,
        entry.source.to,
      ].every(Number.isSafeInteger)
    )
      return entry;
  } catch {
    /* Storage unavailable or corrupt: editing still works. */
  }
}
export function savePosition(id: string, position: WritingPosition) {
  try {
    if (vaultSession.active) {
      vaultSession.payload!.positions[id] = position;
      vaultSession.preferencesDirty = true;
      return;
    }
    let entries: Record<string, WritingPosition> = {};
    try {
      entries = JSON.parse(localStorage.getItem(key) ?? "{}");
    } catch {
      /* Reset corrupt preferences only. */
    }
    if (!entries || Array.isArray(entries) || typeof entries !== "object")
      entries = {};
    delete entries[id];
    entries[id] = position;
    localStorage.setItem(
      key,
      JSON.stringify(Object.fromEntries(Object.entries(entries).slice(-200))),
    );
  } catch {
    /* Quota/privacy restrictions must never prevent saving notes. */
  }
}
