import { invoke } from "@tauri-apps/api/core";
import { native, store, documentHistory } from "./storage";
import { vaultSession } from "./vault";
export type Inventory = {
  assets: { id: string; size: number; referenced: boolean }[];
  database: number;
  recovery: number;
  vault: number;
};
export async function inventory(): Promise<Inventory> {
  await store.flush();
  await store.flushRecovery();
  if (store.recoverable.length || store.recoveryState === "error")
    throw new Error("STORAGE_PENDING_RECOVERY");
  if (native && !vaultSession.active) return invoke("storage_inventory");
  const referenced = new Set<string>();
  const collect = (body: string) => {
    for (const m of body.matchAll(/asset:([a-f0-9]{64})/g))
      referenced.add(m[1]);
  };
  for (const d of store.data.documents) {
    collect(d.body);
    for (const h of await documentHistory(d.id)) collect(h.document.body);
  }
  for (const d of store.recovery?.documents ?? []) collect(d.body);
  if (vaultSession.active) {
    for (const entries of Object.values(vaultSession.payload!.history))
      for (const h of entries) collect(h.document.body);
  }
  return {
    assets: store.data.assets.map((a) => ({
      ...a,
      referenced: referenced.has(a.id),
    })),
    database: 0,
    recovery: 0,
    vault: vaultSession.active
      ? new TextEncoder().encode(JSON.stringify(vaultSession.payload)).length
      : 0,
  };
}
export async function cleanup(preview: Inventory) {
  const current = await inventory();
  const unused = new Set(
    current.assets
      .filter(
        (a) =>
          !a.referenced &&
          preview.assets.some((b) => b.id === a.id && !b.referenced),
      )
      .map((a) => a.id),
  );
  if (!native && !vaultSession.active)
    throw new Error("STORAGE_CLEANUP_DESKTOP_ONLY");
  store.change((s) => ({
    ...s,
    assets: s.assets.filter((a) => !unused.has(a.id)),
  }));
  await store.flush();
  await store.flushRecovery();
  if (vaultSession.active) {
    for (const id of unused) delete vaultSession.payload!.assets[id];
    vaultSession.preferencesDirty = true;
    await store.flush();
  } else await invoke("cleanup_assets", { ids: [...unused] });
  return unused.size;
}
