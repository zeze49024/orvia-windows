// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { test, expect } from "vitest";
import {
  conversationsSchema,
  conversationContext,
  type AiConversation,
} from "./ai-history";
import { emptyWorkspace, newDocument, workspaceSchema } from "./model";
import { createBackup, prepareRestore } from "./backup";
import { WorkspaceStore } from "./storage";
import { openVault } from "./vault-crypto";
import { vaultSession } from "./vault";
function chat(documentId: string): AiConversation {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    documentId,
    title: "test",
    createdAt: now,
    updatedAt: now,
    messages: [
      {
        id: crypto.randomUUID(),
        role: "user",
        content: "PRIVATE AI CHAT",
        quote: "selected fragment",
        createdAt: now,
      },
      {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "answer",
        createdAt: now,
        proposal: { title: "title", body: "revised" },
        fingerprint: "a".repeat(64),
      },
    ],
  };
}
test("old workspaces migrate, transcripts are strict and size/count/identity bounded", () => {
  const old = emptyWorkspace();
  delete (old.settings as any).aiConversations;
  expect(workspaceSchema.parse(old).settings.aiConversations).toEqual([]);
  const c = chat(crypto.randomUUID());
  expect(conversationsSchema.parse([c])).toEqual([c]);
  expect(() => conversationsSchema.parse([c, c])).toThrow();
  expect(() =>
    conversationsSchema.parse([
      { ...c, messages: [{ ...c.messages[0], role: "system" }] },
    ]),
  ).toThrow();
  expect(() =>
    conversationsSchema.parse([
      { ...c, messages: [{ ...c.messages[0], key: "secret" }] },
    ]),
  ).toThrow();
  expect(() =>
    conversationsSchema.parse(
      Array.from({ length: 41 }, () => ({ ...c, id: crypto.randomUUID() })),
    ),
  ).toThrow();
  expect(() =>
    conversationsSchema.parse(
      Array.from({ length: 22 }, () => ({
        ...c,
        id: crypto.randomUUID(),
        messages: [{ ...c.messages[0], content: "x".repeat(220000) }],
      })),
    ),
  ).toThrow();
});
test("conversation context only includes recent in-budget user/assistant messages", () => {
  const c = chat(crypto.randomUUID());
  const all = conversationContext(c.messages, 1000);
  expect(all).toHaveLength(2);
  expect(all[0].content).toContain("selected fragment");
  expect(all[1].content).toContain("revised");
  expect(conversationContext(c.messages, all[1].content.length)).toEqual([
    all[1],
  ]);
  expect(conversationContext(c.messages, 0)).toEqual([]);
  const many = Array.from({ length: 25 }, (_, i) => ({
    ...c.messages[0],
    content: String(i),
    quote: undefined,
  }));
  expect(conversationContext(many, 10000)).toHaveLength(20);
  expect(conversationContext(many, 10000)[0].content).toBe("5");
});
test("backup imports remap chats to copied documents and make old proposals review-only", async () => {
  const data = emptyWorkspace(),
    doc = newDocument(data.libraries[0].id, "note", "body");
  data.documents = [doc];
  data.settings.aiConversations = [chat(doc.id)];
  const bytes = await createBackup(data);
  const restored = await prepareRestore(emptyWorkspace(), bytes);
  const imported = restored.data.settings.aiConversations[0];
  expect(imported.documentId).not.toBe(doc.id);
  expect(restored.data.documents[0].id).toBe(imported.documentId);
  expect(imported.messages[1].fingerprint).toBeUndefined();
  expect(imported.messages[0].content).toBe("PRIVATE AI CHAT");
});
test("backup excludes trashed note conversations but retains living chats without preferences", async () => {
  const data = emptyWorkspace(),
    living = newDocument(data.libraries[0].id, "living", "body"),
    trash = {
      ...newDocument(data.libraries[0].id, "trash", "body"),
      deletedAt: new Date().toISOString(),
    };
  data.documents = [living, trash];
  data.settings.aiConversations = [chat(living.id), chat(trash.id)];
  const result = await prepareRestore(
    emptyWorkspace(),
    await createBackup(data, { trash: false, settings: false }),
  );
  expect(result.data.documents).toHaveLength(1);
  expect(result.data.settings.aiConversations).toHaveLength(1);
  expect(result.data.settings.aiConversations[0].documentId).toBe(
    result.data.documents[0].id,
  );
});
test("private chat persists only in encrypted vault, clears on lock and follows backup remapping", async () => {
  const s = new WorkspaceStore();
  await s.load();
  await s.createVault("test AI vault password 1234");
  const doc = newDocument(s.data.libraries[0].id, "private note", "body");
  s.change((w) => ({
    ...w,
    documents: [doc],
    settings: { ...w.settings, aiConversations: [chat(doc.id)] },
  }));
  await s.flush();
  const bytes = await vaultSession.backup();
  expect(new TextDecoder().decode(bytes)).not.toContain("PRIVATE AI CHAT");
  await s.lockVault();
  expect(s.data.settings.aiConversations).toEqual([]);
  await s.unlockVault("test AI vault password 1234");
  expect(s.data.settings.aiConversations[0].messages[0].content).toBe(
    "PRIVATE AI CHAT",
  );
  const opened = await openVault(bytes, "test AI vault password 1234");
  await s.mergeVaultBackup(await vaultSession.validate(opened.value));
  expect(s.data.settings.aiConversations).toHaveLength(2);
  const copied = s.data.settings.aiConversations.find(
    (c) => c.documentId !== doc.id,
  )!;
  expect(s.data.documents.some((d) => d.id === copied.documentId)).toBe(true);
  expect(copied.messages[1].fingerprint).toBeUndefined();
  s.change((w) => ({ ...w, documents: [] }));
  await s.flush();
  expect(s.data.settings.aiConversations).toHaveLength(0);
  await s.openPublic();
  expect(s.data.settings.aiConversations).toHaveLength(0);
}, 20000);
