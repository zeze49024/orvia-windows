import "fake-indexeddb/auto";
import { describe, it, expect } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
  emptyWorkspace,
  newDocument,
  workspaceSchema,
  safeFilename,
  sha256,
} from "./model";
import { createBackup, inspectBackup, importBackup, safeUnzip } from "./backup";
import { WorkspaceStore } from "./storage";
import { translator, languageRegistry } from "../i18n";

describe("workspace invariants", () => {
  it("rejects missing libraries and image references", () => {
    const s = emptyWorkspace();
    s.documents.push(newDocument(crypto.randomUUID(), "Orphan"));
    expect(workspaceSchema.safeParse(s).success).toBe(false);
    s.documents = [
      newDocument(s.libraries[0].id, "Broken", `![](asset:${"a".repeat(64)})`),
    ];
    expect(workspaceSchema.safeParse(s).success).toBe(false);
  });
  it("retains stable document IDs and safe export names", () => {
    const d = newDocument(crypto.randomUUID(), "Title");
    expect(d.id).toMatch(/^[a-f0-9-]{36}$/);
    expect(safeFilename("../CON:*?")).not.toMatch(/[<>:"/\\|?*]/);
    expect(safeFilename("CON")).toBe("_CON");
  });
});
describe("backup integrity and non-destructive restore", () => {
  it("round trips content and restores as independent libraries", async () => {
    const source = emptyWorkspace();
    source.documents = [
      newDocument(source.libraries[0].id, "中文标题", "Hello **world**"),
    ];
    const bytes = await createBackup(source);
    const inspected = await inspectBackup(bytes);
    expect(inspected.data).toEqual(source);
    const restored = await importBackup(source, bytes);
    expect(restored.documents).toHaveLength(2);
    expect(restored.documents[0]).toEqual(source.documents[0]);
    expect(restored.documents[1].id).not.toBe(source.documents[0].id);
    expect(restored.libraries).toHaveLength(2);
  });
  it("rejects tampered backup before import", async () => {
    const source = emptyWorkspace(),
      bytes = await createBackup(source),
      files = unzipSync(bytes);
    files["workspace.json"] = strToU8("{}");
    await expect(inspectBackup(zipSync(files))).rejects.toThrow(
      "BACKUP_INTEGRITY",
    );
  });
  it("rejects traversal archives", () => {
    expect(() => safeUnzip(zipSync({ "../outside": strToU8("bad") }))).toThrow(
      "UNSAFE_ARCHIVE",
    );
  });
});
describe("persistence conflict handling", () => {
  it("persists edits across reload and refuses stale overwrites", async () => {
    const first = new WorkspaceStore();
    await first.load();
    const second = new WorkspaceStore();
    await second.load();
    first.change((s) => ({
      ...s,
      documents: [newDocument(s.libraries[0].id, "Saved note", "Disk content")],
    }));
    await first.flush();
    const check = new WorkspaceStore();
    await check.load();
    expect(check.data.documents[0].body).toBe("Disk content");
    second.change((s) => ({
      ...s,
      documents: [
        newDocument(s.libraries[0].id, "Stale draft", "Keep this draft"),
      ],
    }));
    await expect(second.flush()).rejects.toThrow("CONFLICT");
    expect(second.status).toBe("error");
    expect(second.dirty).toBe(true);
    expect(second.data.documents[0].body).toBe("Keep this draft");
    const fresh = new WorkspaceStore();
    await fresh.load();
    expect(fresh.data.documents[0].body).toBe("Disk content");
  });
});
describe("offline localization", () => {
  it("provides complete messages in all three languages", () => {
    for (const { code } of languageRegistry) {
      expect(translator(code)("saveError")).toBeTruthy();
      expect(translator(code)("restoreConfirm")).toBeTruthy();
      expect(translator(code)("updateHint")).toBeTruthy();
    }
    expect(translator("en")("all")).toBe("All documents");
  });
  it("hashes assets deterministically", async () => {
    expect(await sha256(strToU8("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
