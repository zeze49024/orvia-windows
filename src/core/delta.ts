import { assetSchema, docSchema, librarySchema, type Workspace } from "./model";
export function workspaceDelta(before: Workspace | null, after: Workspace) {
  const diff = <T extends { id: string }>(old: T[], next: T[]) => {
    const previous = new Map(old.map((v) => [v.id, v]));
    const ids = new Set(next.map((v) => v.id));
    return {
      upsert: next.filter((v) => previous.get(v.id) !== v),
      remove: old.filter((v) => !ids.has(v.id)).map((v) => v.id),
    };
  };
  const libraries = diff(before?.libraries ?? [], after.libraries),
    documents = diff(before?.documents ?? [], after.documents),
    assets = diff(before?.assets ?? [], after.assets);
  libraries.upsert.forEach((v) => librarySchema.parse(v));
  documents.upsert.forEach((v) => docSchema.parse(v));
  assets.upsert.forEach((v) => assetSchema.parse(v));
  const libs = new Set(after.libraries.map((v) => v.id)),
    images = new Set(after.assets.map((v) => v.id));
  if (
    !libs.size ||
    libs.size !== after.libraries.length ||
    after.libraries.length > 200 ||
    after.documents.length > 20000 ||
    after.assets.length > 10000 ||
    new Set(after.documents.map((v) => v.id)).size !== after.documents.length ||
    images.size !== after.assets.length
  )
    throw new Error("INVALID_WORKSPACE");
  // Only inspect all bodies when a library/asset is removed; normal typing validates one note.
  for (const d of libraries.remove.length || assets.remove.length
    ? after.documents
    : documents.upsert) {
    if (!libs.has(d.libraryId)) throw new Error("UNKNOWN_LIBRARY");
    for (const m of d.body.matchAll(/asset:([a-f0-9]{64})/g))
      if (!images.has(m[1])) throw new Error("MISSING_ASSET");
  }
  return {
    libraries,
    documents,
    assets,
    settings: before?.settings === after.settings ? null : after.settings,
  };
}
export type WorkspaceDelta = ReturnType<typeof workspaceDelta> & {
  history?: Record<string, import("./history").HistoryEntry[]>;
};
