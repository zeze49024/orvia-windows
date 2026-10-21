import { strToU8, strFromU8, zipSync, unzipSync } from "fflate";
import { z } from "zod";
import {
  workspaceSchema,
  sha256,
  APP_VERSION,
  type Workspace,
  type Asset,
} from "./model";
import { getAsset, putAsset } from "./storage";
const manifestSchema = z.object({
  format: z.literal("orvia-backup"),
  formatVersion: z.literal(1),
  appVersion: z.string(),
  createdAt: z.string().datetime(),
  workspaceHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export function safeUnzip(bytes: Uint8Array, limit = 256 * 1024 * 1024) {
  if (bytes.length > 128 * 1024 * 1024) throw new Error("FILE_TOO_LARGE");
  let total = 0,
    count = 0;
  return unzipSync(bytes, {
    filter: (entry) => {
      if (
        ++count > 20000 ||
        entry.name.startsWith("/") ||
        entry.name.includes("\\") ||
        entry.name.split("/").includes("..") ||
        /^[A-Za-z]:/.test(entry.name)
      )
        throw new Error("UNSAFE_ARCHIVE");
      total += entry.originalSize;
      if (total > limit || entry.originalSize > 32 * 1024 * 1024)
        throw new Error("ARCHIVE_TOO_LARGE");
      return true;
    },
  });
}
export async function createBackup(data: Workspace) {
  workspaceSchema.parse(data);
  const bytes = strToU8(JSON.stringify(data));
  if (
    bytes.length > 32 * 1024 * 1024 ||
    bytes.length + data.assets.reduce((sum, asset) => sum + asset.size, 0) >
      256 * 1024 * 1024 - 4096
  )
    throw new Error("BACKUP_SIZE_LIMIT");
  const entries: Record<string, Uint8Array> = {
    "workspace.json": bytes,
    "manifest.json": strToU8(
      JSON.stringify({
        format: "orvia-backup",
        formatVersion: 1,
        appVersion: APP_VERSION,
        createdAt: new Date().toISOString(),
        workspaceHash: await sha256(bytes),
      }),
    ),
  };
  for (const a of data.assets) entries["assets/" + a.id] = await getAsset(a);
  const backup = zipSync(entries, { level: 1 });
  if (backup.length > 128 * 1024 * 1024) throw new Error("BACKUP_SIZE_LIMIT");
  return backup;
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
  return { data, files };
}
export async function importBackup(current: Workspace, bytes: Uint8Array) {
  const { data, files } = await inspectBackup(bytes);
  const libraries = new Map(
    data.libraries.map((l) => [l.id, crypto.randomUUID()]),
  );
  for (const asset of data.assets)
    await putAsset(files["assets/" + asset.id], asset.mime);
  return workspaceSchema.parse({
    ...current,
    libraries: [
      ...current.libraries,
      ...data.libraries.map((l) => ({ ...l, id: libraries.get(l.id)! })),
    ],
    documents: [
      ...current.documents,
      ...data.documents.map((d) => ({
        ...d,
        id: crypto.randomUUID(),
        libraryId: libraries.get(d.libraryId)!,
      })),
    ],
    assets: Array.from(
      new Map(
        [...current.assets, ...data.assets].map((a) => [a.id, a]),
      ).values(),
    ),
  });
}
export function mergeAssets(old: Asset[], added: Asset[]) {
  return Array.from(new Map([...old, ...added].map((a) => [a.id, a])).values());
}
