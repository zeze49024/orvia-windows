// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { expect, test } from "vitest";
import { zipSync, strToU8, strFromU8 } from "fflate";
import { emptyWorkspace, newDocument, defaultShortcuts, sha256 } from "./model";
import {
  searchNotes,
  validateShortcuts,
  templates,
  matchesShortcut,
} from "./productivity";
import { imageDimensions, validateImage } from "./image-validation";
import {
  createBackup,
  inspectBackup,
  prepareRestore,
  safeUnzip,
} from "./backup";
import { snapshot } from "./history";
import { store, documentHistory, putAsset } from "./storage";
import { inventory } from "./storage-management";
import { vaultSession } from './vault';
import { toBase64 } from './vault-crypto';
test('encrypted backup validates image pixels even when the image is only retained by history',async()=>{
 const bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jC1sAAAAASUVORK5CYII='),c=>c.charCodeAt(0));new DataView(bytes.buffer).setUint32(16,100000);
 const id=await sha256(bytes),workspace=emptyWorkspace(),doc=newDocument(workspace.libraries[0].id,'Current','current');workspace.documents=[doc];
 await expect(vaultSession.validate({version:1,revision:0,workspace,assets:{[id]:toBase64(bytes)},history:{[doc.id]:[snapshot({...doc,body:`![old](asset:${id})`},[{id,mime:'image/png',size:bytes.length}],1)]},recovery:null,positions:{}})).rejects.toThrow('IMAGE_PIXEL_LIMIT');
});
test("advanced search combines fields, dates, library and favorite without executing regex", () => {
  const w = emptyWorkspace();
  const a = newDocument(w.libraries[0].id, "Alpha", "needle [x] 中文");
  a.starred = true;
  a.tags = ["work"];
  const b = newDocument(w.libraries[0].id, "Beta", "needle");
  w.documents = [a, b];
  const f = {
    query: "[x]",
    field: "all" as const,
    library: "",
    starred: true,
    after: "",
    before: "",
  };
  expect(searchNotes(w, f).map((h) => h.document.id)).toEqual([a.id]);
  expect(searchNotes(w, { ...f, field: "title" })).toEqual([]);
  expect(searchNotes(w, { ...f, query: "work", field: "tags" })).toHaveLength(
    1,
  );
  expect(searchNotes(w, { ...f, before: "2000-01-01" })).toHaveLength(0);
  expect(templates("en")).toHaveLength(4);
  expect(templates("zh-TW")[1].body).toContain("今日計劃");
});
test("shortcut settings reject duplicates, reserved keys and match only exact modifiers", () => {
  expect(
    validateShortcuts({ ...defaultShortcuts, searchAll: "ctrl+shift+k" })
      .searchAll,
  ).toBe("Ctrl+Shift+K");
  expect(() =>
    validateShortcuts({ ...defaultShortcuts, newNote: "Ctrl+K" }),
  ).toThrow("CONFLICT");
  expect(() =>
    validateShortcuts({ ...defaultShortcuts, newNote: "Ctrl+W" }),
  ).toThrow("RESERVED");
  expect(() =>
    validateShortcuts({ ...defaultShortcuts, newNote: "Alt+F4" }),
  ).toThrow();
  expect(
    matchesShortcut(
      new KeyboardEvent("keydown", { key: "k", ctrlKey: true }),
      "Ctrl+K",
    ),
  ).toBe(true);
  expect(
    matchesShortcut(
      new KeyboardEvent("keydown", { key: "k", ctrlKey: true, shiftKey: true }),
      "Ctrl+K",
    ),
  ).toBe(false);
});
test("image header guards prevent pixel bombs and MIME confusion before storing", async () => {
  const png = Uint8Array.from(
    atob(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jC1sAAAAASUVORK5CYII=",
    ),
    (c) => c.charCodeAt(0),
  );
  expect(imageDimensions(png)).toMatchObject({
    width: 1,
    height: 1,
    mime: "image/png",
  });
  const bomb = png.slice();
  new DataView(bomb.buffer).setUint32(16, 100000);
  expect(() => imageDimensions(bomb)).toThrow("PIXEL");
  await expect(putAsset(png, "image/jpeg")).rejects.toThrow("MIME");
  await expect(validateImage(new Uint8Array([1, 2, 3]))).rejects.toThrow();
});
test("ZIP unsafe paths and true expanded limits are rejected", () => {
  expect(() => safeUnzip(zipSync({ "../outside": strToU8("bad") }))).toThrow();
  expect(() => safeUnzip(zipSync({ "C:drive": strToU8("bad") }))).toThrow();
  expect(() =>
    safeUnzip(zipSync({ large: new Uint8Array(2000) }), 1000),
  ).toThrow();
});
test("v2 backup round trip preserves history, trash and optional settings, rejects tampered history", async () => {
  await store.load();
  const w = emptyWorkspace();
  const note = newDocument(w.libraries[0].id, "Versioned", "current");
  const trash = newDocument(w.libraries[0].id, "Deleted", "trash");
  trash.deletedAt = new Date().toISOString();
  w.documents = [note, trash];
  w.settings.theme = "dark";
  const old = snapshot({ ...note, body: "original" }, [], 123);
  const archive = await createBackup(w, {
    history: { [note.id]: [old] },
    trash: true,
    settings: true,
  });
  const preview = await inspectBackup(archive);
  expect(preview.history[note.id][0].document.body).toBe("original");
  expect(preview.data.documents[1].deletedAt).not.toBeNull();
  const current = emptyWorkspace();
  const merged = await prepareRestore(current, archive, false);
  expect(merged.data.settings.theme).toBe(current.settings.theme);
  expect(merged.data.documents[0].id).not.toBe(note.id);
  await store.applyRestore(merged.data, merged.history);
  expect(
    (await documentHistory(merged.data.documents[0].id))[0].document.body,
  ).toBe("original");
  const restored = await prepareRestore(current, archive, true);
  expect(restored.data.settings.theme).toBe("dark");
  const files = safeUnzip(archive);
  files["history.json"] = strToU8(
    strFromU8(files["history.json"]).replace("original", "tampered"),
  );
  await expect(inspectBackup(zipSync(files))).rejects.toThrow(
    "HISTORY_INTEGRITY",
  );
  const omitted = await inspectBackup(
    await createBackup(w, { history: {}, trash: false, settings: false }),
  );
  expect(omitted.data.documents).toHaveLength(1);
  expect(omitted.manifest.settingsIncluded).toBe(false);
  expect(await sha256(archive)).toMatch(/^[a-f0-9]{64}$/);
  expect((await inventory()).assets).toEqual([]);
});
