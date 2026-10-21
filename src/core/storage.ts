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
  if (native) return invoke("document_history", { id });
  const database = await db();
  return new Promise((resolve, reject) => {
    const req = database.transaction("history").objectStore("history").get(id);
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror = () => reject(req.error);
  });
}
export class WorkspaceStore {
  data: Workspace = emptyWorkspace();
  revision = 0;
  path = "";
  status: "loading" | "saved" | "saving" | "error" = "loading";
  error = "";
  ready = false;
  private initialized = false;
  private persisted: Workspace | null = null;
  private forceHistory = new Set<string>();
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
    this.status = "saving";
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
    this.status = "saving";
    this.emit();
    try {
      const delta = workspaceDelta(this.persisted, data);
      this.revision = native
        ? await invoke<number>("save_delta", {
            delta,
            forceHistory,
            expectedRevision: this.revision,
          })
        : await writePreview(data, delta, this.revision, forceHistory);
      this.persisted = data;
      forceHistory.forEach((id) => this.forceHistory.delete(id));
      this.savedGeneration = generation;
      this.error = "";
      this.status = this.dirty ? "saving" : "saved";
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
  const id = await sha256(bytes);
  if (native) {
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
  if (native)
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
