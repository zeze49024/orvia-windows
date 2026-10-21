// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import {
  editorExtensions,
  canEditRichly,
  documentOutline,
  setSourceHeading,
} from "./editor";
const editors: Editor[] = [];
function create(content = "") {
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: editorExtensions(),
    content,
    contentType: "markdown",
  });
  editors.push(editor);
  return editor;
}
afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()));

describe("live Markdown editing", () => {
  it("applies every heading level and returns to a normal paragraph", () => {
    const editor = create("标题文字");
    for (const level of [1, 2, 3, 4, 5, 6] as const) {
      editor.commands.setHeading({ level });
      expect(editor.getMarkdown().trimEnd()).toBe("#".repeat(level) + " 标题文字");
      expect(editor.getHTML()).toContain(`<h${level}>标题文字</h${level}>`);
    }
    editor.commands.setParagraph();
    expect(editor.getMarkdown().trimEnd()).toBe("标题文字");
  });
  it("sets whole source lines rather than stacking Markdown heading markers", () => {
    const original = "前文\n## 小节 ##\n末尾";
    expect(setSourceHeading(original, 7, 7, 1).value).toBe(
      "前文\n# 小节\n末尾",
    );
    expect(setSourceHeading(original, 7, 7, 0).value).toBe("前文\n小节\n末尾");
    expect(setSourceHeading("一\n二\n三", 0, 4, 6).value).toBe(
      "###### 一\n###### 二\n三",
    );
    expect(setSourceHeading("", 0, 0, 3).value).toBe("### ");
  });
  it("builds a hierarchical outline without treating code as headings", () => {
    const markdown =
      "# **一级**\n\n```md\n# 代码示例\n```\n\n### [三级](https://example.com)\n\n二级标题\n---\n\n# 一级";
    const outline = documentOutline(markdown);
    expect(outline.map(({ level, text }) => [level, text])).toEqual([
      [1, "一级"],
      [3, "三级"],
      [2, "二级标题"],
      [1, "一级"],
    ]);
    expect(outline[1].offset).toBe(markdown.indexOf("###"));
  });
  it("round trips existing headings, marks, lists, tasks, tables, quotes, code and asset IDs", () => {
    const original =
      "# 标题\n\n中文 **加粗** 和 *斜体*，`code` [链接](https://example.com)\n\n- 项目\n  - 子项\n\n1. 第一项\n2. 第二项\n\n- [ ] 待办\n- [x] 完成\n\n> 引用\n\n```ts\nconst n = 1\n```\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n![图](asset:" +
      "a".repeat(64) +
      ")\n\n---";
    const editor = create(original);
    expect(canEditRichly(original, editor.getMarkdown())).toBe(true);
    expect(editor.getHTML()).toContain('type="checkbox"');
    expect(editor.getHTML()).toContain("<table");
    expect(editor.getMarkdown()).toContain("asset:" + "a".repeat(64));
  });
  it("formats actual selections and supports undo/redo without losing Chinese text", () => {
    const editor = create("中文笔记");
    editor.commands.setTextSelection({ from: 1, to: 3 });
    editor.commands.toggleBold();
    expect(editor.getMarkdown()).toContain("**中文**笔记");
    editor.commands.undo();
    expect(editor.getMarkdown()).toBe("中文笔记");
    editor.commands.redo();
    expect(editor.getMarkdown()).toContain("**中文**笔记");
  });
  it("updates tasks and editable tables and preserves them after reopening", () => {
    const editor = create("- [ ] 待办\n\n| A | B |\n| --- | --- |\n| 1 | 2 |");
    editor.commands.setTextSelection(3);
    editor.commands.updateAttributes("taskItem", { checked: true });
    const saved = editor.getMarkdown();
    expect(saved).toContain("[x]");
    expect(canEditRichly(saved, create(saved).getMarkdown())).toBe(true);
  });
  it("routes unsupported HTML and footnotes to source mode rather than losing content", () => {
    for (const original of [
      "<details><summary>标题</summary>秘密内容</details>",
      "正文[^1]\n\n[^1]: 脚注内容",
      "<!-- 保留这条注释 -->\n\n正文",
    ]) {
      expect(canEditRichly(original, create(original).getMarkdown())).toBe(
        false,
      );
    }
    expect(canEditRichly("first\n\nsecond", "first")).toBe(false);
  });
  it("never emits network image sources or executable link URLs", () => {
    const editor = create(
      "![remote](https://example.com/track.png)\n\n![asset](asset:" +
        "b".repeat(64) +
        ")\n\n[bad](javascript:alert(1))",
    );
    const html = editor.getHTML();
    expect(html).not.toContain("<img");
    expect(html).not.toContain('href="javascript:');
    expect(editor.getMarkdown()).toContain("https://example.com/track.png");
  });
  it("does not emit a write when opening or programmatically syncing content", () => {
    const editor = create("Original **text**");
    let writes = 0;
    editor.on("update", () => writes++);
    editor.commands.setContent("Synced text", {
      contentType: "markdown",
      emitUpdate: false,
    });
    expect(writes).toBe(0);
    editor.commands.insertContent("!");
    expect(writes).toBe(1);
  });
});
