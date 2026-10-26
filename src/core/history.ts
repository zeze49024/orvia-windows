import { z } from "zod";
import { assetSchema, docSchema } from "./model";
export const historyEntrySchema = z.object({
  id: z.number().int(),
  savedAt: z.string().datetime(),
  document: docSchema,
  assets: z.array(assetSchema).max(10000),
});
export const historyMapSchema = z.record(
  z.string(),
  z.array(historyEntrySchema).max(20),
);
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
