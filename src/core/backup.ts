import { strToU8, strFromU8, zipSync, unzipSync } from "fflate";
import { z } from "zod";
import { historyMapSchema, type HistoryEntry } from "./history";
import { imageDimensions } from "./image-validation";
import {
  workspaceSchema,
  sha256,
  APP_VERSION,
  type Workspace,
  type Asset,
} from "./model";
import { getAsset, putAsset, documentHistory, store } from "./storage";
const manifestSchema = z.object({
  format: z.literal("orvia-backup"),
  formatVersion: z.union([z.literal(1), z.literal(2)]),
  historyHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  settingsIncluded: z.boolean().optional(),
  trashIncluded: z.boolean().optional(),
  appVersion: z.string(),
  createdAt: z.string().datetime(),
  workspaceHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export function safeUnzip(bytes: Uint8Array, limit = 256 * 1024 * 1024) {
  if (bytes.length > 128 * 1024 * 1024) throw new Error("FILE_TOO_LARGE");
  let total = 0,
    count = 0;
  const names = new Set<string>();
  const files = unzipSync(bytes, {
    filter: (entry) => {
      if (
        ++count > 20000 ||
        names.has(entry.name) ||
        entry.name.includes(":") ||
        entry.name.includes("\0") ||
        !Number.isSafeInteger(entry.originalSize) ||
        entry.originalSize < 0 ||
        entry.name.startsWith("/") ||
        entry.name.includes("\\") ||
        entry.name.split("/").includes("..") ||
        /^[A-Za-z]:/.test(entry.name)
      )
        throw new Error("UNSAFE_ARCHIVE");
      names.add(entry.name);
      total += entry.originalSize;
      if (total > limit || entry.originalSize > 32 * 1024 * 1024)
        throw new Error("ARCHIVE_TOO_LARGE");
      return true;
    },
  });
  let actual = 0;
  for (const entry of Object.values(files)) {
    actual += entry.byteLength;
    if (entry.byteLength > 32 * 1024 * 1024 || actual > limit)
      throw new Error("ARCHIVE_TOO_LARGE");
  }
  return files;
}
export type BackupOptions = {
  history?: Record<string, HistoryEntry[]>;
  settings?: boolean;
  trash?: boolean;
};
export async function collectHistory(data: Workspace) {
  const history: Record<string, HistoryEntry[]> = {};
  let size = 0;
  for (const doc of data.documents) {
    const entries = await documentHistory(doc.id);
    if (entries.length) {
      size += new TextEncoder().encode(JSON.stringify(entries)).length;
      if (size > 32 * 1024 * 1024) throw new Error("BACKUP_HISTORY_SIZE");
      history[doc.id] = entries;
    }
  }
  return history;
}
export async function createBackup(
  original: Workspace,
  options?: BackupOptions,
) {
  const data: Workspace = structuredClone(original);
  if (options?.trash === false)
    data.documents = data.documents.filter((d) => !d.deletedAt);
  const noteIds = new Set(data.documents.map((d) => d.id));
  const chats = data.settings.aiConversations.filter((c) =>
    noteIds.has(c.documentId),
  );
  if (options?.settings === false)
    data.settings = structuredClone(
      (await import("./model")).emptyWorkspace(data.settings.locale).settings,
    );
  // Conversations are note content, not preferences. Honor the trash boundary
  // without dropping chats when the user excludes application settings.
  data.settings = { ...data.settings, aiConversations: chats };
  const history = Object.fromEntries(
    Object.entries(options?.history ?? {}).filter(([id]) =>
      data.documents.some((d) => d.id === id),
    ),
  );
  data.assets = mergeAssets(
    data.assets,
    Object.values(history).flatMap((entries) =>
      entries.flatMap((entry) => entry.assets),
    ),
  );
  workspaceSchema.parse(data);
  const bytes = strToU8(JSON.stringify(data)),
    historyBytes = strToU8(JSON.stringify(history));
  if (
    bytes.length > 32 * 1024 * 1024 ||
    historyBytes.length > 32 * 1024 * 1024 ||
    bytes.length +
      historyBytes.length +
      data.assets.reduce((n, a) => n + a.size, 0) >
      256 * 1024 * 1024 - 4096
  )
    throw new Error("BACKUP_SIZE_LIMIT");
  const entries: Record<string, Uint8Array> = { "workspace.json": bytes };
  const manifest = {
    format: "orvia-backup",
    formatVersion: options ? 2 : 1,
    appVersion: APP_VERSION,
    createdAt: new Date().toISOString(),
    workspaceHash: await sha256(bytes),
    ...(options
      ? {
          historyHash: await sha256(historyBytes),
          settingsIncluded: options.settings !== false,
          trashIncluded: options.trash !== false,
        }
      : {}),
  };
  entries["manifest.json"] = strToU8(JSON.stringify(manifest));
  if (options) entries["history.json"] = historyBytes;
  for (const asset of data.assets)
    entries["assets/" + asset.id] = await getAsset(asset);
  const archive = zipSync(entries, { level: 1 });
  if (archive.length > 128 * 1024 * 1024) throw new Error("BACKUP_SIZE_LIMIT");
  return archive;
}
export async function createFullBackup(
  data: Workspace,
  options: { history: boolean; trash: boolean; settings: boolean },
) {
  await store.flush();
  return createBackup(data, {
    history: options.history ? await collectHistory(data) : {},
    trash: options.trash,
    settings: options.settings,
  });
}
export async function inspectBackup(bytes: Uint8Array) {
  const files = safeUnzip(bytes);
  const manifest = manifestSchema.parse(
    JSON.parse(strFromU8(files["manifest.json"] ?? new Uint8Array())),
  );
  const workspaceBytes = files["workspace.json"];
  if (
    !workspaceBytes ||
    (await sha256(workspaceBytes)) !== manifest.workspaceHash
  )
    throw new Error("BACKUP_INTEGRITY");
  const data = workspaceSchema.parse(JSON.parse(strFromU8(workspaceBytes)));
  for (const asset of data.assets) {
    const bytes = files["assets/" + asset.id];
    if (
      !bytes ||
      bytes.length !== asset.size ||
      (await sha256(bytes)) !== asset.id
    )
      throw new Error("ASSET_INTEGRITY");
  }
  let history: Record<string, HistoryEntry[]> = {};
  if (manifest.formatVersion === 2) {
    const bytes = files["history.json"];
    if (
      !bytes ||
      !manifest.historyHash ||
      (await sha256(bytes)) !== manifest.historyHash
    )
      throw new Error("BACKUP_HISTORY_INTEGRITY");
    history = historyMapSchema.parse(JSON.parse(strFromU8(bytes)));
    for (const [id, entries] of Object.entries(history)) {
      if (!data.documents.some((d) => d.id === id))
        throw new Error("BACKUP_HISTORY_INTEGRITY");
      for (const entry of entries) {
        if (entry.document.id !== id)
          throw new Error("BACKUP_HISTORY_INTEGRITY");
        for (const match of entry.document.body.matchAll(
          /asset:([a-f0-9]{64})/g,
        ))
          if (!data.assets.some((a) => a.id === match[1]))
            throw new Error("BACKUP_HISTORY_INTEGRITY");
      }
    }
  }
  for (const asset of data.assets) {
    if (imageDimensions(files["assets/" + asset.id]).mime !== asset.mime)
      throw new Error("ASSET_INTEGRITY");
  }
  return { data, files, history, manifest };
}
export async function prepareRestore(
  current: Workspace,
  bytes: Uint8Array,
  restoreSettings = false,
) {
  const { data, files, history, manifest } = await inspectBackup(bytes);
  const libraries = new Map(
    data.libraries.map((l) => [l.id, crypto.randomUUID()]),
  );
  const ids = new Map(data.documents.map((d) => [d.id, crypto.randomUUID()]));
  const chats = data.settings.aiConversations
    .filter((c) => ids.has(c.documentId))
    .map((c) => ({
      ...c,
      id: crypto.randomUUID(),
      documentId: ids.get(c.documentId)!,
      messages: c.messages.map((m) => ({
        ...m,
        id: crypto.randomUUID(),
        fingerprint: undefined,
        anchor: undefined,
      })),
    }));
  const next = workspaceSchema.parse({
    ...current,
    settings: {
      ...(restoreSettings && manifest.settingsIncluded !== false
        ? data.settings
        : current.settings),
      aiConversations: [...current.settings.aiConversations, ...chats],
    },
    libraries: [
      ...current.libraries,
      ...data.libraries.map((l) => ({ ...l, id: libraries.get(l.id)! })),
    ],
    documents: [
      ...current.documents,
      ...data.documents.map((d) => ({
        ...d,
        id: ids.get(d.id)!,
        libraryId: libraries.get(d.libraryId)!,
      })),
    ],
    assets: mergeAssets(current.assets, data.assets),
  });
  const mapped: Record<string, HistoryEntry[]> = {};
  for (const [id, entries] of Object.entries(history)) {
    mapped[ids.get(id)!] = entries.map((entry) => ({
      ...entry,
      document: {
        ...entry.document,
        id: ids.get(id)!,
        libraryId:
          libraries.get(entry.document.libraryId) ??
          libraries.get(data.documents.find((d) => d.id === id)!.libraryId)!,
      },
    }));
  }
  for (const a of data.assets) await putAsset(files["assets/" + a.id], a.mime);
  return { data: next, history: mapped };
}
export async function importBackup(current: Workspace, bytes: Uint8Array) {
  return (await prepareRestore(current, bytes)).data;
}
export function mergeAssets(old: Asset[], added: Asset[]) {
  return Array.from(new Map([...old, ...added].map((a) => [a.id, a])).values());
}
