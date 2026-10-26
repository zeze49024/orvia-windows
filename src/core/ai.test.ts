// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { test, expect } from "vitest";
import { store, documentHistory } from "./storage";
import { newDocument } from "./model";
import {
  aiSnapshot,
  applyAiProposal,
  assertCurrent,
  validateProposal,
  lineDiff,
  aiOutputSchema,
} from "./ai";
import { aiError } from "./ai-errors";
import { translator } from "@/i18n";
test("AI applies only to an unchanged authorized note and keeps durable pre-AI history", async () => {
  await store.load();
  const doc = newDocument(store.data.libraries[0].id, "Original", "old body");
  store.change((s) => ({ ...s, documents: [doc] }));
  await store.flush();
  const base = await aiSnapshot(doc);
  await applyAiProposal(base, { title: "Improved", body: "new body" });
  expect(store.data.documents[0].body).toBe("new body");
  expect(
    (await documentHistory(doc.id)).some((h) => h.document.body === "old body"),
  ).toBe(true);
  await expect(
    applyAiProposal(base, { title: "Stale", body: "stale body" }),
  ).rejects.toThrow("AI_CONFLICT");
  expect(store.data.documents[0].body).toBe("new body");
  const current = await aiSnapshot(store.data.documents[0]);
  store.change((s) => ({
    ...s,
    documents: s.documents.map((d) => ({
      ...d,
      deletedAt: new Date().toISOString(),
    })),
  }));
  expect(() => assertCurrent(current)).toThrow("AI_CONFLICT");
  await store.flush();
});
test("AI proposals cannot introduce or silently remove local image references", () => {
  const id = "a".repeat(64),
    base = {
      id: crypto.randomUUID(),
      title: "title",
      body: `![image](asset:${id})`,
      fingerprint: "f".repeat(64),
      encrypted: false,
    };
  expect(() =>
    validateProposal(base, { title: "title", body: "no image" }),
  ).toThrow("AI_IMAGE_REFERENCES");
  expect(() =>
    validateProposal(
      { ...base, body: "empty" },
      { title: "title", body: base.body },
    ),
  ).toThrow();
  expect(() =>
    validateProposal(base, { title: "title", body: base.body + "\n\nExtra" }),
  ).not.toThrow();
});
test("invalid tool metadata and raw errors cannot become instructions or credential leaks", () => {
  expect(() =>
    aiOutputSchema.parse({
      answer: "ok",
      proposal: null,
      inputTokens: 1,
      outputTokens: 1,
      requests: 1,
      actions: ["run_sql"],
    }),
  ).toThrow();
  expect(
    aiError("HTTP error secret-provider-key-1234", translator("en")),
  ).not.toContain("secret-provider-key");
  expect(aiError("AI_AUTH", translator("en"))).toContain("Invalid key");
});
test("diff retains only changed block with context counts", () => {
  expect(lineDiff("same\nold\nend", "same\nnew\nend")).toEqual({
    unchangedBefore: 1,
    unchangedAfter: 1,
    removed: "old",
    added: "new",
  });
  expect(lineDiff("same", "same").removed).toBe("");
});
