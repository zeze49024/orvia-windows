import { z } from "zod";
import { localeCodes } from "../i18n/registry";
export const APP_VERSION = "0.1.0-beta7";
export const RELEASE_NOTE =
  "优化写作稳定性与 Markdown 文件兼容性，完善编辑与文件往返回归验证";
export const colors = ["blue", "orange", "green", "purple", "rose"] as const;
export const librarySchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  color: z.enum(colors),
});
export const assetSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/),
  mime: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif"]),
  size: z
    .number()
    .int()
    .positive()
    .max(20 * 1024 * 1024),
});
export const docSchema = z.object({
  id: z.string().uuid(),
  libraryId: z.string().uuid(),
  title: z.string().max(300),
  body: z.string().max(5_000_000),
  tags: z.array(z.string().max(40)).max(20),
  starred: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  openedAt: z.string().datetime().nullable(),
  deletedAt: z.string().datetime().nullable(),
});
export const workspaceSchema = z
  .object({
    schemaVersion: z.literal(1),
    libraries: z.array(librarySchema).min(1).max(200),
    documents: z.array(docSchema).max(20000),
    assets: z.array(assetSchema).max(10000),
    settings: z.object({
      locale: z.enum(localeCodes),
      sidebar: z.boolean(),
      layout: z.enum(["grid", "list"]),
      theme: z
        .string()
        .regex(/^[a-z][a-z0-9-]{0,63}$/)
        .default("light"),
    }),
  })
  .superRefine((s, ctx) => {
    const libs = new Set(s.libraries.map((l) => l.id));
    if (
      libs.size !== s.libraries.length ||
      new Set(s.documents.map((d) => d.id)).size !== s.documents.length ||
      new Set(s.assets.map((a) => a.id)).size !== s.assets.length
    )
      ctx.addIssue({ code: "custom", message: "DUPLICATE_ID" });
    const ids = new Set(s.assets.map((a) => a.id));
    for (const d of s.documents) {
      if (!libs.has(d.libraryId))
        ctx.addIssue({ code: "custom", message: "UNKNOWN_LIBRARY" });
      for (const match of d.body.matchAll(/asset:([a-f0-9]{64})/g))
        if (!ids.has(match[1]))
          ctx.addIssue({ code: "custom", message: "MISSING_ASSET" });
    }
  });
export type Workspace = z.infer<typeof workspaceSchema>;
export type Document = Workspace["documents"][number];
export type Library = Workspace["libraries"][number];
export type Asset = Workspace["assets"][number];
export type Locale = Workspace["settings"]["locale"];
export function emptyWorkspace(locale: Locale = "zh-CN"): Workspace {
  return {
    schemaVersion: 1,
    libraries: [
      {
        id: crypto.randomUUID(),
        name:
          locale === "en"
            ? "Personal notes"
            : locale === "zh-TW"
              ? "個人筆記"
              : "个人笔记",
        color: "blue",
      },
    ],
    documents: [],
    assets: [],
    settings: { locale, sidebar: true, layout: "grid", theme: "light" },
  };
}
export function newDocument(
  libraryId: string,
  title: string,
  body = "",
): Document {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    libraryId,
    title,
    body,
    tags: [],
    starred: false,
    createdAt: now,
    updatedAt: now,
    openedAt: now,
    deletedAt: null,
  };
}
export function safeFilename(title: string) {
  return (
    title
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
      .replace(/[. ]+$/g, "")
      .slice(0, 100) || "Untitled"
  ).replace(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?=\.|$)/i, "_$1");
}
export async function sha256(bytes: Uint8Array) {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new Uint8Array(bytes).buffer,
  );
  return Array.from(new Uint8Array(hash), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
export const extensions = {
  authentication: false,
  cloudStorage: false,
  cloudSync: false,
} as const;
export function unavailableCloud(): never {
  throw new Error("CLOUD_DISABLED");
}
