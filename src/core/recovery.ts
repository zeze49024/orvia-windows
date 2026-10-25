import { z } from "zod";
import {
  docSchema,
  librarySchema,
  assetSchema,
  type Workspace,
  type Document,
} from "./model";
export const recoverySchema = z.object({
  schemaVersion: z.literal(1),
  savedAt: z.string().datetime(),
  documents: z.array(docSchema).max(20000),
  libraries: z.array(librarySchema).max(200),
  assets: z.array(assetSchema).max(10000),
});
export type Recovery = z.infer<typeof recoverySchema>;
export function recoveryCandidates(journal: Recovery | null, data: Workspace) {
  const saved = new Map(data.documents.map((d) => [d.id, d]));
  return (
    journal?.documents.filter((doc) => {
      const current = saved.get(doc.id);
      return (
        !doc.deletedAt &&
        (!current ||
          (!current.deletedAt &&
            (current.title !== doc.title || current.body !== doc.body)))
      );
    }) ?? []
  );
}
export function makeRecovery(
  before: Workspace | null,
  data: Workspace,
  pending: Recovery | null,
): Recovery {
  const old = new Map(before?.documents.map((d) => [d.id, d]) ?? []);
  const documents = new Map(pending?.documents.map((d) => [d.id, d]) ?? []);
  for (const doc of data.documents) {
    const saved = old.get(doc.id);
    if (
      !doc.deletedAt &&
      (!saved || saved.title !== doc.title || saved.body !== doc.body)
    )
      documents.set(doc.id, doc);
  }
  return {
    schemaVersion: 1,
    savedAt: new Date().toISOString(),
    documents: [...documents.values()],
    libraries: [
      ...new Map(
        [...(pending?.libraries ?? []), ...data.libraries].map((l) => [
          l.id,
          l,
        ]),
      ).values(),
    ],
    assets: [
      ...new Map(
        [...(pending?.assets ?? []), ...data.assets].map((a) => [a.id, a]),
      ).values(),
    ],
  };
}
export function recoverCopies(
  data: Workspace,
  journal: Recovery,
  suffix: string,
): { data: Workspace; ids: string[] } {
  const candidates = recoveryCandidates(journal, data);
  if (data.documents.length + candidates.length > 20000)
    throw new Error("DOCUMENT_LIMIT");
  const copies: Document[] = candidates.map((doc) => ({
    ...doc,
    id: crypto.randomUUID(),
    title: (doc.title + suffix).slice(0, 300),
    libraryId: data.libraries.some((l) => l.id === doc.libraryId)
      ? doc.libraryId
      : data.libraries[0].id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    openedAt: null,
    deletedAt: null,
  }));
  return {
    data: {
      ...data,
      documents: [...copies, ...data.documents],
      assets: [
        ...new Map(
          [...data.assets, ...journal.assets].map((a) => [a.id, a]),
        ).values(),
      ],
    },
    ids: copies.map((d) => d.id),
  };
}
let database: Promise<IDBDatabase> | undefined;
async function recoveryDb() {
  return (database ??= new Promise((resolve, reject) => {
    const req = indexedDB.open("orvia-writing-recovery", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("checkpoint");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}
export async function readBrowserRecovery(): Promise<unknown> {
  const db = await recoveryDb();
  return new Promise((resolve, reject) => {
    const req = db
      .transaction("checkpoint")
      .objectStore("checkpoint")
      .get("main");
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}
export async function writeBrowserRecovery(journal: Recovery) {
  const db = await recoveryDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("checkpoint", "readwrite");
    tx.objectStore("checkpoint").put(journal, "main");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
