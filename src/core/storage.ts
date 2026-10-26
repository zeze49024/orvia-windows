import { vaultSession, type VaultPayload } from "./vault";
import { toBase64 } from "./vault-crypto";
import { validateImage } from "./image-validation";
import {
  quarantineBrowserRecovery,
  makeRecovery,
  readBrowserRecovery,
  writeBrowserRecovery,
  recoverySchema,
  recoveryCandidates,
  recoverCopies,
  type Recovery,
} from "./recovery";
import { workspaceDelta, type WorkspaceDelta } from "./delta";
import { snapshot, type HistoryEntry } from "./history";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  emptyWorkspace,
  workspaceSchema,
  sha256,
  type Workspace,
  type Asset,
} from "./model";
export const native = isTauri();
type Stored = { revision: number; data: Workspace | null; path?: string };
let dbPromise: Promise<IDBDatabase> | undefined;
function db() {
  return (dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open("orvia-windows-browser-preview", 3);
    req.onupgradeneeded = () => {
      for (const name of [
        "workspace",
        "assets",
        "documents",
        "libraries",
        "metadata",
        "history",
      ])
        if (!req.result.objectStoreNames.contains(name))
          req.result.createObjectStore(name);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}
async function readPreview(): Promise<Stored> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction([
      "workspace",
      "documents",
      "libraries",
      "metadata",
    ]);
    const main = tx.objectStore("workspace").get("main");
    const docs = tx.objectStore("documents").getAll(),
      libs = tx.objectStore("libraries").getAll(),
      meta = tx.objectStore("metadata").get("main");
    tx.oncomplete = () =>
      resolve(
        meta.result
          ? {
              revision: meta.result.revision,
              data: {
                ...meta.result.data,
                documents: docs.result,
                libraries: libs.result,
              },
            }
          : (main.result ?? { revision: 0, data: null }),
      );
    tx.onerror = () => reject(tx.error);
  });
}
async function writePreview(
  data: Workspace,
  delta: WorkspaceDelta,
  expected: number,
  force: string[],
): Promise<number> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(
      ["workspace", "documents", "libraries", "metadata", "history"],
      "readwrite",
    );
    let conflict = false;
    const meta = tx.objectStore("metadata").get("main"),
      legacy = tx.objectStore("workspace").get("main");
    meta.onsuccess = () => {
      legacy.onsuccess = commit;
      if (legacy.readyState === "done") commit();
    };
    function commit() {
      if (
        (meta.result?.revision ?? legacy.result?.revision ?? 0) !== expected
      ) {
        conflict = true;
        tx.abort();
        return;
      }
      const old = legacy.result?.data as Workspace | undefined;
      if (!meta.result && old) {
        old.documents.forEach((d) => tx.objectStore("documents").put(d, d.id));
        old.libraries.forEach((l) => tx.objectStore("libraries").put(l, l.id));
      }
      for (const d of delta.documents.upsert) {
        const req = tx.objectStore("documents").get(d.id);
        req.onsuccess = () => {
          const previous = req.result;
          if (
            previous &&
            (previous.body !== d.body || previous.title !== d.title)
          ) {
            const history = tx.objectStore("history").get(d.id);
            history.onsuccess = () => {
              const entries: HistoryEntry[] = history.result ?? [];
              if (
                force.includes(d.id) ||
                !entries.length ||
                Date.now() - Date.parse(entries[0].savedAt) >= 60000
              )
                entries.unshift(
                  snapshot(
                    previous,
                    meta.result?.data.assets ?? old?.assets ?? [],
                    Date.now(),
                  ),
                );
              // Bounded by both number and serialized bytes per note.
              while (
                entries.length > 20 ||
                JSON.stringify(entries).length > 20_000_000
              )
                entries.pop();
              tx.objectStore("history").put(entries, d.id);
            };
          }
          tx.objectStore("documents").put(d, d.id);
        };
      }
      delta.documents.remove.forEach((id) => {
        tx.objectStore("documents").delete(id);
        tx.objectStore("history").delete(id);
      });
      delta.libraries.upsert.forEach((l) =>
        tx.objectStore("libraries").put(l, l.id),
      );
      delta.libraries.remove.forEach((id) =>
        tx.objectStore("libraries").delete(id),
      );
      for (const [id, entries] of Object.entries(delta.history ?? {}))
        tx.objectStore("history").put(entries, id);
      tx.objectStore("metadata").put(
        {
          revision: expected + 1,
          data: {
            schemaVersion: 1,
            settings: data.settings,
            assets: data.assets,
          },
        },
        "main",
      );
      tx.objectStore("workspace").delete("main");
    }
    tx.oncomplete = () => resolve(expected + 1);
    tx.onabort = () =>
      reject(new Error(conflict ? "CONFLICT" : String(tx.error)));
    tx.onerror = () => reject(tx.error);
  });
}
export async function documentHistory(id: string): Promise<HistoryEntry[]> {
  await store.flush();
  if (vaultSession.active)
    return structuredClone(vaultSession.payload!.history[id] ?? []);
  if (native) return invoke("document_history", { id });
  const database = await db();
  return new Promise((resolve, reject) => {
    const req = database.transaction("history").objectStore("history").get(id);
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror = () => reject(req.error);
  });
}
export class WorkspaceStore {
  vaultMode: "public" | "private" | "locked" = "public";
  vaultAvailable = false;
  private setVaultHint(active: boolean) {
    try {
      localStorage.setItem("orvia-active-vault", active ? "1" : "0");
      if (active)
        localStorage.setItem("orvia-vault-locale", this.data.settings.locale);
    } catch {}
  }
  private enterVault(payload: VaultPayload) {
    this.vaultAvailable = true;
    this.vaultMode = "private";
    this.data = payload.workspace;
    this.persisted = this.data;
    this.revision = payload.revision;
    this.generation = 0;
    this.savedGeneration = 0;
    this.recovery = payload.recovery;
    this.recoveryWarning = vaultSession.warning;
    this.recoveryBlocked = false;
    this.recoveryState = "saved";
    this.ready = true;
    this.status = "saved";
    this.error = "";
    this.path = "orvia-vault://local";
    this.setVaultHint(true);
    this.emit();
  }
  async unlockVault(password: string) {
    if (this.vaultMode === "public") {
      await this.flush();
      await this.flushRecovery();
    }
    try {
      const p = await vaultSession.unlock(password);
      this.enterVault(p);
    } catch (error) {
      vaultSession.lock();
      throw error;
    }
  }
  async createVault(password: string, copy = false) {
    await this.flush();
    await this.flushRecovery();
    const data = copy
      ? structuredClone(this.data)
      : emptyWorkspace(this.data.settings.locale);
    data.settings.autoBackup.enabled = false;
    const assets: Record<string, string> = {};
    let size = 0;
    for (const a of data.assets) {
      size += a.size;
      if (size > 50 * 1024 * 1024) throw new Error("VAULT_SIZE");
      assets[a.id] = toBase64(await getAsset(a));
    }
    const history: Record<string, HistoryEntry[]> = {};
    if (copy)
      for (const d of data.documents) {
        history[d.id] = await documentHistory(d.id);
      }
    const p = await vaultSession.create(password, data, assets, history);
    this.enterVault(p);
  }
  async createVaultFromBackup(password: string, payload: VaultPayload) {
    if (this.vaultMode !== "public") throw new Error("VAULT_MODE");
    await this.flush();
    await this.flushRecovery();
    const p = await vaultSession.create(
      password,
      payload.workspace,
      payload.assets,
      payload.history,
      { recovery: payload.recovery, positions: payload.positions },
    );
    this.enterVault(p);
  }
  async mergeVaultBackup(payload: VaultPayload) {
    if (!vaultSession.active) throw new Error("VAULT_LOCKED");
    await this.flush();
    if (payload.recovery)
      payload = {
        ...payload,
        workspace: recoverCopies(
          payload.workspace,
          payload.recovery,
          " (Recovered)",
        ).data,
      };
    const libraries = new Map(
      payload.workspace.libraries.map((l) => [l.id, crypto.randomUUID()]),
    );
    const ids = new Map(
      payload.workspace.documents.map((d) => [d.id, crypto.randomUUID()]),
    );
    const mapDoc = (d: Workspace["documents"][number]) => ({
      ...d,
      id: ids.get(d.id)!,
      libraryId: libraries.get(d.libraryId) ?? libraries.values().next().value!,
    });
    const history = Object.fromEntries(
      Object.entries(payload.history).map(([id, entries]) => [
        ids.get(id)!,
        entries.map((e) => ({ ...e, document: mapDoc(e.document) })),
      ]),
    );
    const next = workspaceSchema.parse({
      ...this.data,
      libraries: [
        ...this.data.libraries,
        ...payload.workspace.libraries.map((l) => ({
          ...l,
          id: libraries.get(l.id)!,
        })),
      ],
      documents: [
        ...this.data.documents,
        ...payload.workspace.documents.map(mapDoc),
      ],
      assets: [
        ...new Map(
          [...this.data.assets, ...payload.workspace.assets].map((a) => [
            a.id,
            a,
          ]),
        ).values(),
      ],
    });
    const assets = { ...vaultSession.payload!.assets, ...payload.assets };
    if (
      new TextEncoder().encode(
        JSON.stringify({
          ...vaultSession.payload,
          workspace: next,
          assets,
          history: { ...vaultSession.payload!.history, ...history },
        }),
      ).length >
      80 * 1024 * 1024
    )
      throw new Error("VAULT_SIZE");
    vaultSession.payload!.assets = assets;
    await this.applyRestore(next, history);
  }
  async lockVault() {
    if (this.vaultMode !== "private") return;
    try {
      await this.flush();
    } catch {
      await this.flushRecovery();
      if (this.recoveryState !== "saved") throw new Error("VAULT_UNSAVED");
    }
    await this.flushRecovery();
    clearTimeout(this.timer);
    clearTimeout(this.recoveryTimer);
    const locale = this.data.settings.locale;
    vaultSession.lock();
    this.data = emptyWorkspace(locale);
    this.persisted = null;
    this.generation = 0;
    this.savedGeneration = 0;
    this.recovery = null;
    this.ready = false;
    this.status = "saved";
    this.vaultMode = "locked";
    this.error = "";
    this.emit();
  }
  async openPublic() {
    if (this.vaultMode === "private") await this.lockVault();
    this.setVaultHint(false);
    this.vaultMode = "public";
    this.ready = false;
    this.status = "loading";
    this.initialized = false;
    this.emit();
    await this.load();
  }
  async changeVaultPassword(password: string) {
    if (this.recoverable.length) throw new Error("VAULT_PENDING_RECOVERY");
    await this.flush();
    await this.flushRecovery();
    vaultSession.payload!.recovery = null;
    await vaultSession.changePassword(password);
  }

  data: Workspace = emptyWorkspace();
  revision = 0;
  path = "";
  status: "loading" | "saved" | "saving" | "error" = "loading";
  error = "";
  ready = false;
  private initialized = false;
  private persisted: Workspace | null = null;
  private forceHistory = new Set<string>();
  private importedHistory: Record<string, HistoryEntry[]> = {};
  async applyRestore(data: Workspace, history: Record<string, HistoryEntry[]>) {
    workspaceSchema.parse(data);
    this.importedHistory = history;
    this.change(() => data);
    await this.flush();
    await this.flushRecovery();
  }
  async restoreHistory(entry: HistoryEntry) {
    this.forceHistory.add(entry.document.id);
    this.change((s) => ({
      ...s,
      assets: [
        ...new Map(
          [...s.assets, ...entry.assets].map((a) => [a.id, a]),
        ).values(),
      ],
      documents: s.documents.map((d) =>
        d.id === entry.document.id
          ? {
              ...entry.document,
              pinned: d.pinned,
              libraryId: s.libraries.some(
                (l) => l.id === entry.document.libraryId,
              )
                ? entry.document.libraryId
                : d.libraryId,
              updatedAt: new Date().toISOString(),
              deletedAt: d.deletedAt,
            }
          : d,
      ),
    }));
    await this.flush();
  }
  recovery: Recovery | null = null;
  recoveryWarning = false;
  private recoveryBlocked = false;
  recoveryState: "saving" | "saved" | "error" = "saved";
  private recoveryQueue: Promise<void> = Promise.resolve();
  private recoveryTimer: ReturnType<typeof setTimeout> | undefined;
  private recoveryTicket = 0;
  get recoverable() {
    return recoveryCandidates(this.recovery, this.data);
  }
  async flushRecovery() {
    if (this.recoveryTimer) {
      clearTimeout(this.recoveryTimer);
      this.recoveryTimer = undefined;
      this.checkpoint();
    }
    await this.recoveryQueue;
  }
  private checkpoint() {
    const journal = makeRecovery(this.persisted, this.data, this.recovery),
      ticket = ++this.recoveryTicket;
    this.recoveryState = "saving";
    this.recoveryQueue = this.recoveryQueue.then(async () => {
      try {
        if (this.recoveryBlocked) throw new Error("RECOVERY_QUARANTINE");
        if (
          new TextEncoder().encode(JSON.stringify(journal)).length >
          64 * 1024 * 1024
        )
          throw new Error("RECOVERY_SIZE");
        if (vaultSession.active)
          await vaultSession.checkpoint(this.data, journal);
        else if (native) await invoke("write_recovery", { data: journal });
        else await writeBrowserRecovery(journal);
        if (ticket === this.recoveryTicket) this.recoveryState = "saved";
      } catch {
        if (ticket === this.recoveryTicket) this.recoveryState = "error";
      }
      this.emit();
    });
  }
  async recoverDrafts(suffix: string) {
    if (!this.recovery) return [];
    const restored = recoverCopies(this.data, this.recovery, suffix);
    this.recovery = null;
    this.change(() => restored.data);
    await this.flush();
    return restored.ids;
  }
  async discardDrafts() {
    const previous = this.recovery;
    this.recovery = null;
    this.checkpoint();
    await this.flushRecovery();
    if (this.recoveryState === "error") {
      this.recovery = previous;
      this.emit();
      throw new Error("RECOVERY_WRITE");
    }
    this.emit();
  }
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;
  private savedGeneration = 0;
  private running: Promise<void> | null = null;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private emit() {
    this.listeners.forEach((fn) => fn());
  }
  async load() {
    if (this.initialized) return;
    this.initialized = true;
    try {
      this.vaultAvailable = await vaultSession.exists();
      let preferVault = false;
      try {
        preferVault = localStorage.getItem("orvia-active-vault") === "1";
      } catch {}
      if (this.vaultAvailable && preferVault) {
        let locale: Workspace["settings"]["locale"] =
          navigator.language.startsWith("en")
            ? "en"
            : /TW|HK|Hant/.test(navigator.language)
              ? "zh-TW"
              : "zh-CN";
        try {
          const hint = localStorage.getItem("orvia-vault-locale");
          if (hint === "en" || hint === "zh-TW" || hint === "zh-CN")
            locale = hint;
        } catch {}
        this.data = emptyWorkspace(locale);
        this.vaultMode = "locked";
        this.status = "saved";
        this.ready = false;
        this.emit();
        return;
      }
      const result = native
        ? await invoke<Stored>("load_workspace")
        : await readPreview();
      this.path = result.path ?? "IndexedDB";
      this.data = result.data
        ? workspaceSchema.parse(result.data)
        : emptyWorkspace(
            navigator.language.startsWith("en")
              ? "en"
              : /TW|HK|Hant/.test(navigator.language)
                ? "zh-TW"
                : "zh-CN",
          );
      this.persisted = result.data ? this.data : null;
      this.revision = result.revision;
      this.ready = true;
      this.status = "saved";
      try {
        const journal = native
          ? await invoke("read_recovery")
          : await readBrowserRecovery();
        this.recovery = journal ? recoverySchema.parse(journal) : null;
        if (
          this.recovery &&
          !recoveryCandidates(this.recovery, this.data).length
        )
          this.recovery = null;
      } catch {
        this.recoveryState = "error";
        this.recoveryWarning = true;
        try {
          if (native) await invoke("quarantine_recovery");
          else await quarantineBrowserRecovery();
        } catch {
          this.recoveryBlocked = true;
        }
      }
      if (!result.data) {
        this.generation++;
        await this.flush();
      }
    } catch (e) {
      this.ready = false;
      this.initialized = false;
      this.error = String(e);
      this.status = "error";
    }
    this.emit();
  }
  change(update: (data: Workspace) => Workspace) {
    if (!this.ready) throw new Error("STORAGE_NOT_READY");
    this.data = update(this.data);
    this.generation++;
    this.status = this.error ? "error" : "saving";
    this.recoveryTicket++;
    this.recoveryState = "saving";
    clearTimeout(this.recoveryTimer);
    this.recoveryTimer = setTimeout(() => {
      this.recoveryTimer = undefined;
      this.checkpoint();
    }, 120);
    this.emit();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.flush().catch(() => {});
    }, 450);
  }
  get dirty() {
    return this.generation !== this.savedGeneration;
  }
  async flush(): Promise<void> {
    clearTimeout(this.timer);
    if (this.running) {
      await this.running;
      if (this.dirty) return this.flush();
      return;
    }
    if (!this.dirty) {
      if (vaultSession.active && vaultSession.preferencesDirty)
        await vaultSession.save(this.data);
      if (this.status === "error") throw new Error(this.error);
      return;
    }
    this.running = this.write();
    try {
      await this.running;
    } finally {
      this.running = null;
    }
    if (this.dirty) return this.flush();
  }
  private async write() {
    const generation = this.generation;
    const data = this.data;
    const forceHistory = [...this.forceHistory];
    const imported = this.importedHistory;
    this.status = "saving";
    this.emit();
    try {
      await this.flushRecovery();
      const delta: WorkspaceDelta = {
        ...workspaceDelta(this.persisted, data),
        history: imported,
      };
      if (vaultSession.active) {
        const histories = { ...vaultSession.payload!.history, ...imported };
        const previous = new Map(
          this.persisted?.documents.map((d) => [d.id, d]) ?? [],
        );
        for (const doc of data.documents) {
          const old = previous.get(doc.id);
          if (old && (old.body !== doc.body || old.title !== doc.title)) {
            const entries = [...(histories[doc.id] ?? [])];
            if (
              forceHistory.includes(doc.id) ||
              !entries.length ||
              Date.now() - Date.parse(entries[0].savedAt) >= 60000
            ) {
              entries.unshift(
                snapshot(old, this.persisted?.assets ?? [], Date.now()),
              );
              while (
                entries.length > 20 ||
                JSON.stringify(entries).length > 20_000_000
              )
                entries.pop();
              histories[doc.id] = entries;
            }
          }
        }
        for (const id of Object.keys(histories))
          if (!data.documents.some((d) => d.id === id)) delete histories[id];
        this.revision = await vaultSession.save(data, histories);
        this.setVaultHint(true);
      } else {
        this.revision = native
          ? await invoke<number>("save_delta", {
              delta,
              forceHistory,
              expectedRevision: this.revision,
            })
          : await writePreview(data, delta, this.revision, forceHistory);
      }
      if (this.importedHistory === imported) this.importedHistory = {};
      this.persisted = data;
      forceHistory.forEach((id) => this.forceHistory.delete(id));
      this.savedGeneration = generation;
      this.error = "";
      this.status = this.dirty ? "saving" : "saved";
      this.checkpoint();
    } catch (e) {
      this.error = String(e);
      this.status = "error";
      throw e;
    } finally {
      this.emit();
    }
  }
}
export const store = new WorkspaceStore();
export async function putAsset(
  bytes: Uint8Array,
  mime: Asset["mime"],
): Promise<Asset> {
  if (!bytes.length || bytes.length > 20 * 1024 * 1024)
    throw new Error("IMAGE_SIZE");
  const verified = await validateImage(bytes);
  if (verified.mime !== mime) throw new Error("IMAGE_MIME_MISMATCH");
  const id = await sha256(bytes);
  if (vaultSession.active) {
    vaultSession.putAsset(id, bytes);
  } else if (native) {
    const returned = await invoke<string>("put_asset", {
      bytes: Array.from(bytes),
      mime,
    });
    if (returned !== id) throw new Error("HASH_MISMATCH");
  } else {
    const database = await db();
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction("assets", "readwrite");
      tx.objectStore("assets").put({ bytes, mime }, id);
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
      tx.onerror = () => reject(tx.error);
    });
  }
  return { id, mime, size: bytes.length };
}
export async function getAsset(asset: Asset): Promise<Uint8Array> {
  let bytes: Uint8Array;
  if (vaultSession.active) bytes = vaultSession.getAsset(asset.id);
  else if (native)
    bytes = new Uint8Array(
      await invoke<number[]>("read_asset", { id: asset.id }),
    );
  else {
    const database = await db();
    bytes = await new Promise((resolve, reject) => {
      const req = database
        .transaction("assets")
        .objectStore("assets")
        .get(asset.id);
      req.onsuccess = () =>
        req.result
          ? resolve(new Uint8Array(req.result.bytes))
          : reject(new Error("MISSING_ASSET"));
      req.onerror = () => reject(req.error);
    });
  }
  if (bytes.length !== asset.size || (await sha256(bytes)) !== asset.id)
    throw new Error("ASSET_INTEGRITY");
  return bytes;
}
