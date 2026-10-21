import type { Asset, Document } from "./model";
export type HistoryEntry = {
  id: number;
  savedAt: string;
  document: Document;
  assets: Asset[];
};
export function snapshot(
  document: Document,
  assets: Asset[],
  id: number,
): HistoryEntry {
  return {
    id,
    savedAt: new Date().toISOString(),
    document,
    assets: assets.filter((a) => document.body.includes("asset:" + a.id)),
  };
}
