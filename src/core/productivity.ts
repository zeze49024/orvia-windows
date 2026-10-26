export {
  normalizeShortcut,
  validateShortcuts,
  matchesShortcut,
} from "./shortcuts";
import { type Document, type Locale, type Workspace } from "./model";
export const words = (locale: Locale, cn: string, tw: string, en: string) =>
  locale === "en" ? en : locale === "zh-TW" ? tw : cn;
export function templates(locale: Locale) {
  const w = (a: string, b: string, c: string) => words(locale, a, b, c);
  return [
    { id: "blank", name: w("空白笔记", "空白筆記", "Blank note"), body: "" },
    {
      id: "daily",
      name: w("每日记录", "每日記錄", "Daily journal"),
      body: `# ${new Date().toISOString().slice(0, 10)}\n\n## ${w("今日计划", "今日計劃", "Plan")}\n\n- [ ] \n\n## ${w("记录与反思", "記錄與反思", "Notes and reflection")}\n\n`,
    },
    {
      id: "meeting",
      name: w("会议纪要", "會議紀要", "Meeting notes"),
      body: `## ${w("议题", "議題", "Agenda")}\n\n- \n\n## ${w("讨论记录", "討論記錄", "Discussion")}\n\n## ${w("决定与行动", "決定與行動", "Decisions and actions")}\n\n- [ ] `,
    },
    {
      id: "reading",
      name: w("阅读笔记", "閱讀筆記", "Reading notes"),
      body: `## ${w("来源", "來源", "Source")}\n\n## ${w("核心观点", "核心觀點", "Key ideas")}\n\n## ${w("摘录", "摘錄", "Quotes")}\n\n> \n\n## ${w("我的思考", "我的思考", "Reflection")}\n\n`,
    },
  ];
}
export type SearchFilters = {
  query: string;
  field: "all" | "title" | "body" | "tags";
  library: string;
  starred: boolean;
  after: string;
  before: string;
};
export function searchNotes(
  data: Workspace,
  filters: SearchFilters,
): { document: Document; snippet: string; offset: number }[] {
  const needle = filters.query.trim().toLocaleLowerCase();
  return data.documents
    .filter(
      (d) =>
        !d.deletedAt &&
        (!filters.library || d.libraryId === filters.library) &&
        (!filters.starred || d.starred) &&
        (!filters.after || d.updatedAt.slice(0, 10) >= filters.after) &&
        (!filters.before || d.updatedAt.slice(0, 10) <= filters.before),
    )
    .flatMap((document) => {
      const text =
        filters.field === "title"
          ? document.title
          : filters.field === "body"
            ? document.body
            : filters.field === "tags"
              ? document.tags.join(" ")
              : [document.title, document.body, ...document.tags].join("\n");
      if (needle && !text.toLocaleLowerCase().includes(needle)) return [];
      const offset = needle
        ? document.body.toLocaleLowerCase().indexOf(needle)
        : -1;
      const start = Math.max(0, offset - 45);
      return [
        {
          document,
          snippet:
            (start ? "…" : "") +
            document.body.slice(start, start + 180).replace(/\n/g, " "),
          offset,
        },
      ];
    })
    .sort((a, b) => b.document.updatedAt.localeCompare(a.document.updatedAt));
}
