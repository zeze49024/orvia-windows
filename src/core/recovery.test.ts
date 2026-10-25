import "fake-indexeddb/auto";
import { test, expect, vi } from "vitest";
import { WorkspaceStore } from "./storage";
import { emptyWorkspace, newDocument } from "./model";
import {
  makeRecovery,
  recoverCopies,
  recoveryCandidates,
  readBrowserRecovery,
} from "./recovery";
test("recovery ignores committed content and restores divergent drafts as copies without overwriting originals", () => {
  const data = emptyWorkspace(),
    doc = newDocument(data.libraries[0].id, "原稿", "已保存");
  data.documents = [doc];
  const edited = { ...data, documents: [{ ...doc, body: "未保存 **中文**" }] };
  const journal = makeRecovery(data, edited, null);
  expect(recoveryCandidates(journal, data)).toHaveLength(1);
  const recovered = recoverCopies(data, journal, "（恢复副本）");
  expect(recovered.data.documents).toHaveLength(2);
  expect(recovered.data.documents.find((d) => d.id === doc.id)?.body).toBe(
    "已保存",
  );
  expect(recovered.data.documents[0].body).toBe("未保存 **中文**");
  expect(recovered.data.documents[0].id).not.toBe(doc.id);
  expect(recoveryCandidates(journal, edited)).toHaveLength(0);
  expect(
    makeRecovery(
      data,
      { ...data, documents: [{ ...doc, deletedAt: new Date().toISOString() }] },
      null,
    ).documents,
  ).toHaveLength(0);
});
test("database failure keeps draft durable, retry clears the failure, restart retains saved data", async () => {
  const store = new WorkspaceStore();
  await store.load();
  const doc = newDocument(store.data.libraries[0].id, "保存测试", "原文");
  store.change((w) => ({ ...w, documents: [doc] }));
  await store.flush();
  await store.flushRecovery();
  const original = IDBDatabase.prototype.transaction;
  const spy = vi
    .spyOn(IDBDatabase.prototype, "transaction")
    .mockImplementation(function (this: IDBDatabase, names, mode, options) {
      if (
        mode === "readwrite" &&
        Array.from(typeof names === "string" ? [names] : names).includes(
          "documents",
        )
      )
        throw new Error("DISK_FULL");
      return original.call(this, names, mode, options);
    });
  try {
    store.change((w) => ({
      ...w,
      documents: [{ ...doc, body: "仍在窗口里的草稿" }],
    }));
    await expect(store.flush()).rejects.toThrow("DISK_FULL");
    expect(store.status).toBe("error");
    expect(store.dirty).toBe(true);
    expect(store.recoveryState).toBe("saved");
    expect(((await readBrowserRecovery()) as any).documents[0].body).toBe(
      "仍在窗口里的草稿",
    );
  } finally {
    spy.mockRestore();
  }
  await store.flush();
  await store.flushRecovery();
  expect(store.status).toBe("saved");
  expect(store.dirty).toBe(false);
  expect(store.error).toBe("");
  const reopened = new WorkspaceStore();
  await reopened.load();
  expect(reopened.data.documents[0].body).toBe("仍在窗口里的草稿");
  expect(reopened.recoverable).toHaveLength(0);
});
