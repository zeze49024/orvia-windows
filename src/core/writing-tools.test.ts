// @vitest-environment jsdom
import { test, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { editorExtensions, canEditRichly } from "./editor";
import { textMatches, richMatches, replaceMatches } from "./find";
import { markdownImage, imageTitle, imageWidth } from "./image-options";
import { readPosition, savePosition } from "./writing-position";
const editors: Editor[] = [];
function create(content: string) {
  const ed = new Editor({
    extensions: editorExtensions(),
    content,
    contentType: "markdown",
  });
  editors.push(ed);
  return ed;
}
afterEach(() => {
  editors.splice(0).forEach((e) => e.destroy());
  localStorage.clear();
});
test("literal search supports regex punctuation, Unicode and case-sensitive matching", () => {
  expect(textMatches("[a].* [a].*", "[a].*")).toEqual([
    { from: 0, to: 5 },
    { from: 6, to: 11 },
  ]);
  expect(textMatches("Orvia ORVIA orvia", "orvia")).toHaveLength(3);
  expect(textMatches("Orvia ORVIA orvia", "orvia", true)).toEqual([
    { from: 12, to: 17 },
  ]);
  expect(textMatches("😀中文😀中文", "中文")).toEqual([
    { from: 2, to: 4 },
    { from: 6, to: 8 },
  ]);
  expect(textMatches("abc", "")).toEqual([]);
});
test("rich search crosses formatting boundaries without crossing paragraph boundaries", () => {
  const ed = create("中**文**笔记\n\n中文笔记");
  const matches = richMatches(ed.state.doc, "中文");
  expect(matches).toHaveLength(2);
  expect(matches.map((m) => ed.state.doc.textBetween(m.from, m.to))).toEqual([
    "中文",
    "中文",
  ]);
  expect(richMatches(ed.state.doc, "笔记中文")).toHaveLength(0);
});
test("batch replace is literal, preserves unrelated rich marks and undoes in one step", () => {
  const ed = create("**保留** 中文 中文");
  const original = ed.getMarkdown();
  const matches = richMatches(ed.state.doc, "中文");
  ed.view.dispatch(closeHistory(ed.state.tr));
  let tr = ed.state.tr;
  for (const match of [...matches].reverse())
    tr = tr.insertText("$1", match.from, match.to);
  ed.view.dispatch(tr);
  expect(ed.getMarkdown()).toContain("**保留** $1 $1");
  ed.commands.undo();
  expect(ed.getMarkdown()).toBe(original);
  ed.commands.redo();
  expect(ed.getMarkdown()).toContain("$1 $1");
  expect(
    replaceMatches("中文中文", textMatches("中文中文", "中文"), "$&"),
  ).toBe("$&$&");
});
test("image alt and width survive Markdown round trip without corrupting brackets or title", () => {
  const src = "asset:" + "a".repeat(64),
    alt = "图 [示例] \\ 中文",
    title = imageTitle('原始 "标题"', 50);
  const markdown = markdownImage(src, alt, title);
  const ed = create(markdown);
  const img = ed.state.doc.firstChild!;
  expect(img.type.name).toBe("image");
  expect(img.attrs.alt).toBe(alt);
  expect(img.attrs.title).toBe(title);
  expect(imageWidth(img.attrs.title)).toBe(50);
  expect(canEditRichly(markdown, ed.getMarkdown())).toBe(true);
  expect(imageTitle(title, 100)).toBe('原始 "标题"');
  expect(imageWidth("invalid orvia-width:999% ")).toBe(100);
});
test("writing preferences reject malformed positions and retain a bounded list without note contents", () => {
  const p = {
    mode: "source" as const,
    rich: { from: 8, to: 10 },
    source: { from: 14, to: 16, scroll: 55 },
    scroll: 900,
  };
  savePosition("one", p);
  expect(readPosition("one")).toEqual(p);
  for (let i = 0; i < 205; i++) savePosition("note-" + i, p);
  expect(readPosition("one")).toBeUndefined();
  expect(readPosition("note-204")).toEqual(p);
  localStorage.setItem(
    "orvia-writing-positions-v1",
    JSON.stringify({ bad: { ...p, scroll: -1 } }),
  );
  expect(readPosition("bad")).toBeUndefined();
  localStorage.setItem("orvia-writing-positions-v1", "corrupt");
  savePosition("recovered", p);
  expect(readPosition("recovered")).toEqual(p);
});
