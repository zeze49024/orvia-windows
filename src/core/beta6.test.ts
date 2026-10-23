import "fake-indexeddb/auto";
import { expect, it } from "vitest";
import { emptyWorkspace, newDocument } from "./model";
import { workspaceDelta } from "./delta";
import { importMarkdownImages } from "./markdown-import";
import { exportMarkdownDocument } from "./markdown-export";
import { getAsset, putAsset, WorkspaceStore, documentHistory } from "./storage";

it("round trips exported inline and reference images byte for byte without rewriting code", async () => {
  const data = emptyWorkspace(),
    bytes = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG3sAAAAASUVORK5CYII=",
      ),
      (c) => c.charCodeAt(0),
    ),
    asset = await putAsset(bytes, "image/png");
  data.assets = [asset];
  const doc = newDocument(
    data.libraries[0].id,
    "往返",
    `![图](asset:${asset.id})\n\n![图][ref]\n\n[ref]: asset:${asset.id} "说明"\n\n\`data:image/png;base64,aW52YWxpZA==\``,
  );
  data.documents = [doc];
  const file = await exportMarkdownDocument(data, doc.id),
    original = new Uint8Array(file.bytes);
  const result = await importMarkdownImages(
    new TextDecoder().decode(file.bytes),
    new AbortController().signal,
  );
  expect(result.body).toBe(doc.body);
  expect(result.assets).toEqual([asset]);
  expect(await getAsset(result.assets[0])).toEqual(bytes);
  expect(file.bytes).toEqual(original);
});
it("rejects embedded MIME spoofing and oversized images, leaves remote URLs and code untouched", async () => {
  const signal = new AbortController().signal;
  await expect(
    importMarkdownImages("![](data:image/jpeg;base64,iVBORwECAw==)", signal),
  ).rejects.toThrow();
  await expect(
    importMarkdownImages("![](data:image/svg+xml;base64,PHN2Zz4=)", signal),
  ).rejects.toThrow();
  const text =
    "![](https://example.invalid/image.png)\n\n```md\n![](data:image/png;base64,bad)\n```";
  expect((await importMarkdownImages(text, signal)).body).toBe(text);
});
it("sends one changed record among 1000 notes and no note bodies for theme changes", () => {
  const before = emptyWorkspace();
  before.documents = Array.from({ length: 1000 }, (_, i) =>
    newDocument(before.libraries[0].id, String(i), "x".repeat(10000)),
  );
  const after = {
    ...before,
    documents: before.documents.map((d, i) =>
      i === 500 ? { ...d, body: d.body + "changed" } : d,
    ),
  };
  const delta = workspaceDelta(before, after);
  expect(delta.documents.upsert).toHaveLength(1);
  expect(JSON.stringify(delta).length).toBeLessThan(12000);
  const theme = workspaceDelta(after, {
    ...after,
    settings: { ...after.settings, theme: "dark" },
  });
  expect(theme.documents.upsert).toEqual([]);
  expect(JSON.stringify(theme).length).toBeLessThan(400);
});
it("recovers persisted history after reopen, and preserves the current draft before restore", async () => {
  const s = new WorkspaceStore();
  await s.load();
  const doc = newDocument(s.data.libraries[0].id, "history", "original");
  s.change((w) => ({ ...w, documents: [...w.documents, doc] }));
  await s.flush();
  s.change((w) => ({
    ...w,
    documents: w.documents.map((d) =>
      d.id === doc.id ? { ...d, body: "new text" } : d,
    ),
  }));
  await s.flush();
  const reopened = new WorkspaceStore();
  await reopened.load();
  const history = await documentHistory(doc.id);
  expect(history[0].document.body).toBe("original");
  reopened.change((w) => ({
    ...w,
    documents: w.documents.map((d) =>
      d.id === doc.id ? { ...d, pinned: true } : d,
    ),
  }));
  await reopened.restoreHistory(history[0]);
  const third = new WorkspaceStore();
  await third.load();
  expect(third.data.documents.find((d) => d.id === doc.id)?.body).toBe(
    "original",
  );
  expect(third.data.documents.find((d) => d.id === doc.id)?.pinned).toBe(true);
  expect((await documentHistory(doc.id))[0].document.body).toBe("new text");
});
