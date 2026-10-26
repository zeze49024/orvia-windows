import { invoke, isTauri } from "@tauri-apps/api/core";
import { z } from "zod";
import {
  workspaceSchema,
  assetSchema,
  docSchema,
  sha256,
  type Workspace,
} from "./model";
import { recoverySchema, type Recovery } from "./recovery";
import {
  deriveVaultKey,
  sealVault,
  openVault,
  decryptVaultWithKey,
  fromBase64,
  toBase64,
} from "./vault-crypto";
import type { HistoryEntry } from "./history";
import { imageDimensions } from "./image-validation";
const historySchema = z.object({
  id: z.number(),
  savedAt: z.string().datetime(),
  document: docSchema,
  assets: z.array(assetSchema),
});
const positionSchema = z.object({
  mode: z.enum(["rich", "source"]),
  rich: z.object({
    from: z.number().int().nonnegative(),
    to: z.number().int().nonnegative(),
  }),
  source: z.object({
    from: z.number().int().nonnegative(),
    to: z.number().int().nonnegative(),
    scroll: z.number().nonnegative(),
  }),
  scroll: z.number().nonnegative(),
});
export const vaultPayloadSchema = z.object({
  version: z.literal(1),
  revision: z.number().int().nonnegative(),
  workspace: workspaceSchema,
  assets: z.record(z.string().regex(/^[a-f0-9]{64}$/), z.string()),
  history: z.record(z.string(), z.array(historySchema).max(20)),
  recovery: recoverySchema.nullable(),
  positions: z.record(z.string(), positionSchema).default({}),
});
export type VaultPayload = z.infer<typeof vaultPayloadSchema>;
let database: Promise<IDBDatabase> | undefined;
async function vaultDb() {
  return (database ??= new Promise((resolve, reject) => {
    const req = indexedDB.open("orvia-encrypted-vault", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("records");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}
async function readRecord(
  record: "main" | "recovery",
): Promise<{ bytes: Uint8Array; hash: string } | null> {
  if (isTauri()) {
    const r = await invoke<{ bytes: number[]; hash: string } | null>(
      "read_private_record",
      { record },
    );
    return r ? { ...r, bytes: new Uint8Array(r.bytes) } : null;
  }
  const db = await vaultDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction("records").objectStore("records").get(record);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}
async function writeRecord(
  record: "main" | "recovery",
  bytes: Uint8Array,
  expected: string | null,
) {
  const hash = await sha256(bytes);
  if (isTauri()) {
    await invoke("write_private_record", {
      record,
      bytes: Array.from(bytes),
      expected,
    });
    return hash;
  }
  const db = await vaultDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("records", "readwrite"),
      s = tx.objectStore("records"),
      r = s.get(record);
    r.onsuccess = () => {
      if ((r.result?.hash ?? null) !== expected) {
        tx.abort();
        return;
      }
      s.put({ bytes, hash }, record);
    };
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(new Error("VAULT_CONFLICT"));
    tx.onerror = () => reject(tx.error);
  });
  return hash;
}
export class VaultSession {
  key: CryptoKey | null = null;
  salt: Uint8Array | null = null;
  payload: VaultPayload | null = null;
  mainHash: string | null = null;
  recoveryHash: string | null = null;
  preferencesDirty = false;
  warning = false;
  get active() {
    return !!this.key && !!this.payload;
  }
  async exists() {
    try {
      return !!(await readRecord("main"));
    } catch {
      return true;
    }
  }
  async validate(payload: unknown) {
    const p = vaultPayloadSchema.parse(payload);
    let total = 0;
    for (const [id, encoded] of Object.entries(p.assets)) {
      const bytes = fromBase64(encoded);
      total += bytes.length;
      if (total > 80 * 1024 * 1024 || (await sha256(bytes)) !== id)
        throw new Error("VAULT_ASSET_INTEGRITY");
      imageDimensions(bytes);
    }
    for (const a of p.workspace.assets) {
      const encoded = p.assets[a.id];
      if (!encoded || fromBase64(encoded).length !== a.size)
        throw new Error("VAULT_ASSET_INTEGRITY");
      if (imageDimensions(fromBase64(encoded)).mime !== a.mime)
        throw new Error("VAULT_ASSET_INTEGRITY");
    }
    const documents = new Map(p.workspace.documents.map((d) => [d.id, d]));
    for (const [id, entries] of Object.entries(p.history)) {
      if (!documents.has(id)) throw new Error("VAULT_HISTORY_INTEGRITY");
      for (const entry of entries) {
        if (entry.document.id !== id)
          throw new Error("VAULT_HISTORY_INTEGRITY");
        for (const a of entry.assets)
          if (
            !p.assets[a.id] ||
            fromBase64(p.assets[a.id]).length !== a.size ||
            imageDimensions(fromBase64(p.assets[a.id])).mime !== a.mime
          )
            throw new Error("VAULT_ASSET_INTEGRITY");
        for (const m of entry.document.body.matchAll(/asset:([a-f0-9]{64})/g))
          if (!p.assets[m[1]]) throw new Error("VAULT_ASSET_INTEGRITY");
      }
    }
    for (const a of p.recovery?.assets ?? [])
      if (
        !p.assets[a.id] ||
        fromBase64(p.assets[a.id]).length !== a.size ||
        imageDimensions(fromBase64(p.assets[a.id])).mime !== a.mime
      )
        throw new Error("VAULT_ASSET_INTEGRITY");
    for (const d of p.recovery?.documents ?? [])
      for (const m of d.body.matchAll(/asset:([a-f0-9]{64})/g))
        if (!p.assets[m[1]]) throw new Error("VAULT_ASSET_INTEGRITY");
    return p;
  }
  async unlock(password: string) {
    const record = await readRecord("main");
    if (!record) throw new Error("VAULT_MISSING");
    const opened = await openVault(record.bytes, password);
    const payload = await this.validate(opened.value);
    this.key = opened.key;
    this.salt = opened.salt;
    this.payload = payload;
    this.mainHash = record.hash;
    this.warning = false;
    let recovery: Awaited<ReturnType<typeof readRecord>>;
    try {
      recovery = await readRecord("recovery");
    } catch (error) {
      if (!isTauri()) throw error;
      await invoke("quarantine_private_recovery");
      this.warning = true;
      recovery = null;
    }
    this.recoveryHash = recovery?.hash ?? null;
    if (recovery) {
      try {
        const pending = await this.validate(
          await decryptVaultWithKey(recovery.bytes, this.key),
        );
        if (pending.recovery) {
          this.payload.assets = { ...this.payload.assets, ...pending.assets };
          this.payload.recovery = pending.recovery;
        }
      } catch {
        this.warning = true;
        if (isTauri()) await invoke("quarantine_private_recovery");
        else {
          const db = await vaultDb();
          await new Promise<void>((resolve, reject) => {
            const tx = db.transaction("records", "readwrite");
            tx.objectStore("records").put(recovery, "corrupt:" + Date.now());
            tx.objectStore("records").delete("recovery");
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
          });
        }
        this.recoveryHash = null;
      }
    }
    return this.payload;
  }
  async create(
    password: string,
    workspace: Workspace,
    assets: Record<string, string>,
    history: Record<string, HistoryEntry[]> = {},
    extra?: Pick<VaultPayload, "recovery" | "positions">,
  ) {
    if (password.length < 12) throw new Error("VAULT_PASSWORD_LENGTH");
    if (await this.exists()) throw new Error("VAULT_EXISTS");
    const salt = crypto.getRandomValues(new Uint8Array(16)),
      key = await deriveVaultKey(password, salt);
    const payload = await this.validate({
      version: 1,
      revision: 0,
      workspace,
      assets,
      history,
      recovery: extra?.recovery ?? null,
      positions: extra?.positions ?? {},
    });
    const encoded = await sealVault(payload, key, salt);
    const hash = await writeRecord("main", encoded, null);
    this.key = key;
    this.salt = salt;
    this.payload = payload;
    this.mainHash = hash;
    this.recoveryHash = null;
    return payload;
  }
  async checkpoint(workspace: Workspace, recovery: Recovery) {
    if (!this.active) throw new Error("VAULT_LOCKED");
    const payload = { ...this.payload!, workspace, recovery };
    this.recoveryHash = await writeRecord(
      "recovery",
      await sealVault(payload, this.key!, this.salt!),
      this.recoveryHash,
    );
  }
  async save(workspace: Workspace, history?: Record<string, HistoryEntry[]>) {
    if (!this.active) throw new Error("VAULT_LOCKED");
    const next = {
      ...this.payload!,
      workspace,
      history: history ?? this.payload!.history,
      recovery: null,
      revision: this.payload!.revision + 1,
    };
    const hash = await writeRecord(
      "main",
      await sealVault(next, this.key!, this.salt!),
      this.mainHash,
    );
    this.payload = next;
    this.mainHash = hash;
    this.preferencesDirty = false;
    return next.revision;
  }
  async backup(recovery?: Recovery | null) {
    if (!this.active) throw new Error("VAULT_LOCKED");
    return sealVault(
      { ...this.payload!, recovery: recovery ?? this.payload!.recovery },
      this.key!,
      this.salt!,
    );
  }
  async changePassword(password: string) {
    if (!this.active || this.payload?.recovery)
      throw new Error("VAULT_PENDING_RECOVERY");
    if (password.length < 12) throw new Error("VAULT_PASSWORD_LENGTH");
    if (isTauri())
      await invoke("delete_private_recovery", { expected: this.recoveryHash });
    else {
      const db = await vaultDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("records", "readwrite");
        tx.objectStore("records").delete("recovery");
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }
    this.recoveryHash = null;
    const salt = crypto.getRandomValues(new Uint8Array(16)),
      key = await deriveVaultKey(password, salt);
    const bytes = await sealVault(this.payload, key, salt);
    const hash = await writeRecord("main", bytes, this.mainHash);
    this.key = key;
    this.salt = salt;
    this.mainHash = hash;
  }
  lock() {
    this.key = null;
    this.salt?.fill(0);
    this.salt = null;
    this.payload = null;
    this.mainHash = null;
    this.recoveryHash = null;
    this.preferencesDirty = false;
  }
  putAsset(id: string, bytes: Uint8Array) {
    if (!this.payload) throw new Error("VAULT_LOCKED");
    this.payload.assets[id] = toBase64(bytes);
  }
  getAsset(id: string) {
    const value = this.payload?.assets[id];
    if (!value) throw new Error("MISSING_ASSET");
    return fromBase64(value);
  }
}
export const vaultSession = new VaultSession();
