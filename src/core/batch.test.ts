import "fake-indexeddb/auto";
import { expect, it } from "vitest";
import { unzipSync } from "fflate";
import { emptyWorkspace, newDocument, workspaceSchema } from "./model";
import {
  exportDocuments,
  shareDocuments,
  uniqueFilename,
  updateDocuments,
  zipDocuments,
} from "./batch";
import { putAsset } from "./storage";

it("migrates old notes, and keeps pin independent from favorite through move/delete/restore", () => {
  const data = emptyWorkspace(),
    a = newDocument(data.libraries[0].id, "A"),
    b = newDocument(data.libraries[0].id, "B");
  data.documents.push(a, b);
  const old = JSON.parse(JSON.stringify(data));
  delete old.documents[0].pinned;
  expect(workspaceSchema.parse(old).documents[0].pinned).toBe(false);
  const lib = { ...data.libraries[0], id: crypto.randomUUID(), name: "Target" };
  data.libraries.push(lib);
  const pinned = updateDocuments(data, [a.id, b.id], {
    pinned: true,
    libraryId: lib.id,
  });
  expect(data.documents[0].pinned).toBe(false);
  expect(
    pinned.documents.every(
      (d) => d.pinned && !d.starred && d.libraryId === lib.id,
    ),
  ).toBe(true);
  const deleted = updateDocuments(pinned, [a.id], {
    deletedAt: new Date().toISOString(),
  });
  expect(deleted.documents[0].deletedAt).toBeTruthy();
  expect(deleted.documents[1]).toBe(pinned.documents[1]);
  expect(() =>
    updateDocuments(data, [a.id], { libraryId: crypto.randomUUID() }),
  ).toThrow("UNKNOWN_LIBRARY");
});

it("exports all selected bodies with case insensitive duplicate names and no folders in ZIP", async () => {
  const data = emptyWorkspace();
  data.documents.push(
    newDocument(data.libraries[0].id, "Note", "# A"),
    newDocument(data.libraries[0].id, "NOTE", "# B"),
  );
  const files = await exportDocuments(
    data,
    data.documents.map((d) => d.id),
  );
  expect(files.map((f) => f.name)).toEqual(["Note.md", "NOTE (2).md"]);
  const archive = unzipSync(zipDocuments(files));
  expect(Object.keys(archive)).toEqual(["Note.md", "NOTE (2).md"]);
  expect(new TextDecoder().decode(archive["NOTE (2).md"])).toBe("# B");
  expect(uniqueFilename("note.md", new Set(["note.md", "note (2).md"]))).toBe(
    "note (3).md",
  );
});

it("shares self-contained image HTML without executable content or remote fetches", async () => {
  const data = emptyWorkspace(),
    asset = await putAsset(new Uint8Array([137, 80, 78, 71]), "image/png");
  data.assets.push(asset);
  const doc = newDocument(
    data.libraries[0].id,
    "<script>bad()</script>",
    `![local](asset:${asset.id})\n\n![remote](https://example.com/track.png)\n\n<script>alert(1)</script>\n\n[x](javascript:alert%281%29)\n\n# 正文`,
  );
  data.documents.push(doc);
  const html = new TextDecoder().decode(
    (await shareDocuments(data, [doc.id])).bytes,
  );
  expect(html).toContain("data:image/png;base64,iVBORw==");
  expect(html).toContain("Content-Security-Policy");
  expect(html).toContain("&lt;script&gt;bad()&lt;/script&gt;");
  expect(html).not.toContain("<script>");
  expect(html).not.toContain('src="https://');
  expect(html).not.toContain("javascript:");
  expect(html).toContain("正文");
});
