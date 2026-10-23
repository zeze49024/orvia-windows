import { z } from "zod";
import { localeCodes } from "../i18n/registry";
export const APP_VERSION = "0.1.0";
export const RELEASE_NOTE =
  "Orvia v0.1.0 正式版汇总 beta1–beta8 与 rc1–rc3 的更新，完成应用初版构建。\n\n- 编辑与写作：新增所见即所得 Markdown 编辑体验，支持 H1–H6 标题选择及文档大纲；优化文档名称显示、编辑操作、写作稳定性与 Markdown 文件兼容性，并完善文件往返回归验证。\n- 文档与知识库：完善图文导入导出，支持单篇 Markdown 导出，以及批量独立 .md 或 ZIP 导出；新增笔记右键菜单、单篇快捷移动、批量管理、置顶和分享；删除与移动操作增加二次确认。\n- 保存与恢复：新增增量保存和历史恢复，完善本地文档管理与数据持久化验证。\n- 界面与主题：修复 Windows 图标白色背景，优化应用图标、首页与整体可读性；调整功能图标配色、收藏状态和编辑工具栏胶囊布局；新增浅色、深色主题及主题扩展接口，并将设置改为独立页面。\n- 版本更新：支持自动检测 GitHub 新版本，在首页显示更新徽章并提供快捷下载更新；设置中可关闭自动检测。\n- 工程质量：重构代码，加强安装升级、编辑、文件兼容与回归验证。";
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
  pinned: z.boolean().default(false),
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
      autoUpdate: z.boolean().default(true),
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
    settings: {
      locale,
      sidebar: true,
      layout: "grid",
      theme: "light",
      autoUpdate: true,
    },
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
    pinned: false,
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
