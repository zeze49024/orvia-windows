import "fake-indexeddb/auto";
import { expect, it } from "vitest";
import { decodeTextFile } from "./text-file";
import { SourceHistory } from "./source-history";
import { relativeImagePath, markdownFolderFiles } from "./markdown-folder";
import { convertFile } from "./import";
import { exportMarkdownDocument } from "./markdown-export";
import { emptyWorkspace, newDocument } from "./model";
import { replaceDestination } from "./markdown-destination";

const png = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG3sAAAAASUVORK5CYII=",
  ),
  (c) => c.charCodeAt(0),
);
const signal = () => new AbortController().signal;

it("decodes UTF-8 BOM, UTF-16LE/BE BOM and all newline conventions without replacement characters", () => {
  const text = "中文😀\r\n第二行\r末行";
  expect(decodeTextFile(new TextEncoder().encode("\uFEFF" + text))).toBe(
    "中文😀\n第二行\n末行",
  );
  for (const little of [true, false]) {
    const bytes = new Uint8Array(2 + text.length * 2);
    bytes.set(little ? [255, 254] : [254, 255]);
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < text.length; i++)
      view.setUint16(2 + i * 2, text.charCodeAt(i), little);
    expect(decodeTextFile(bytes)).toBe("中文😀\n第二行\n末行");
  }
  for (const bytes of [
    [0xff, 0x61],
    [0xff, 0xfe, 0x61],
    [0x61, 0, 0x62],
  ])
    expect(() => decodeTextFile(new Uint8Array(bytes))).toThrow(
      "TEXT_ENCODING_UNSUPPORTED",
    );
});

it("groups source typing, preserves selection and branches after undo", () => {
  const history = new SourceHistory();
  const s = (value: string) => ({
    value,
    from: value.length,
    to: value.length,
  });
  history.record(s(""), s("中"), true, 1000);
  history.record(s("中"), s("中文"), true, 1100);
  history.boundary();
  history.record(s("中文"), s("**中文**"), false, 1200);
  expect(history.undo(s("**中文**"))).toEqual(s("中文"));
  expect(history.undo(s("中文"))).toEqual(s(""));
  expect(history.redo(s(""))).toEqual(s("中文"));
  history.record(s("中文"), s("新分支"));
  expect(history.canRedo).toBe(false);
  history.reset();
  expect(history.canUndo).toBe(false);
});

it("resolves relative paths within selected root, rejecting encoded escapes, drives and absolute paths", () => {
  expect(relativeImagePath("notes/a.md", "../图片/a%20b.png#part")).toBe(
    "图片/a b.png",
  );
  expect(relativeImagePath("notes/a.md", ".\\assets\\a.png")).toBe(
    "notes/assets/a.png",
  );
  for (const url of [
    "../../outside.png",
    "%2e%2e/%2e%2e/out.png",
    "C:/a.png",
    "/a.png",
    "//host/a.png",
    "file:///a.png",
    "%00.png",
  ])
    expect(() => relativeImagePath("notes/a.md", url)).toThrow();
});

it("replaces only actual destination tokens including escaped parentheses and angle URLs", () => {
  expect(replaceDestination('  [ref]:\n  <old> "title"', "new")).toBe(
    '  [ref]:\n  <new> "title"',
  );
  expect(replaceDestination('![old](old "old")', "new")).toBe(
    '![old](new "old")',
  );
  expect(replaceDestination('![a [b]](<a b.png> "caption")', "asset:abc")).toBe(
    '![a [b]](<asset:abc> "caption")',
  );
  expect(replaceDestination('[a]: images/a\\(1\\).png "caption"', "new")).toBe(
    '[a]: new "caption"',
  );
});

it("imports nested Markdown with relative images, exports a single UTF-8 md and reimports identically", async () => {
  const body =
    '# 中文\n\n![../images/a b.png](<../images/a%20b.png> "title")\n\n![reference][img]\n\n[img]: ../images/a%20b.png\n\n```md\n![](../missing.png)\n```';
  const files = await markdownFolderFiles([
    {
      path: "notes/test.md",
      size: new TextEncoder().encode(body).length,
      read: async () => new TextEncoder().encode(body),
    },
    { path: "images/a b.png", size: png.length, read: async () => png },
  ]);
  const result = await convertFile(files[0], signal());
  expect(result.assets).toHaveLength(1);
  expect(result.body).toContain("![../images/a b.png](<asset:");
  expect(result.body).toContain("![](../missing.png)");
  const data = emptyWorkspace();
  const doc = newDocument(data.libraries[0].id, result.title, result.body);
  data.documents = [doc];
  data.assets = result.assets;
  const exported = await exportMarkdownDocument(data, doc.id);
  expect(exported.name).toBe("test.md");
  const back = await convertFile(exported, signal());
  expect(back.body).toBe(result.body);
  expect(back.assets).toEqual(result.assets);
});

it("stops missing-image imports, ignores remote requests and rejects files changed while reading", async () => {
  const make = async (body: string) =>
    (
      await markdownFolderFiles([
        {
          path: "a.md",
          size: body.length,
          read: async () => new TextEncoder().encode(body),
        },
      ])
    )[0];
  await expect(
    convertFile(await make("![](missing.png)"), signal()),
  ).rejects.toThrow("RELATIVE_IMAGE_NOT_FOUND");
  const remote = "![](https://example.invalid/a.png)";
  expect((await convertFile(await make(remote), signal())).body).toBe(remote);
  await expect(
    markdownFolderFiles([
      { path: "a.md", size: 1, read: async () => new Uint8Array(2) },
    ]),
  ).rejects.toThrow("FILE_CHANGED_DURING_IMPORT");
  const aborted = new AbortController();
  aborted.abort();
  await expect(
    convertFile(await make("text"), aborted.signal),
  ).rejects.toThrow();
});
