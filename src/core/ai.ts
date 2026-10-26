import { z } from "zod";
import { store } from "./storage";
import { sha256, type Document } from "./model";
import { snapshot } from "./history";
import type { AiSnapshot, AiOutput } from "./ai-transport";
export const aiOutputSchema = z
  .object({
    answer: z.string().max(240000),
    proposal: z
      .object({ title: z.string().max(300), body: z.string().max(240000) })
      .strict()
      .nullable(),
    inputTokens: z.number().nonnegative(),
    outputTokens: z.number().nonnegative(),
    requests: z.number().int().min(1).max(4),
    actions: z
      .array(z.enum(["read_current_note", "propose_note_edit"]))
      .max(16),
  })
  .strict();
export async function aiSnapshot(doc: Document): Promise<AiSnapshot> {
  return {
    id: doc.id,
    title: doc.title,
    body: doc.body,
    fingerprint: await sha256(
      new TextEncoder().encode(JSON.stringify([doc.id, doc.title, doc.body])),
    ),
    encrypted: store.vaultMode === "private",
  };
}
export function assertCurrent(base: AiSnapshot) {
  const doc = store.data.documents.find((d) => d.id === base.id);
  if (
    !store.ready ||
    doc?.deletedAt ||
    !doc ||
    doc.body !== base.body ||
    doc.title !== base.title ||
    (store.vaultMode === "private") !== base.encrypted
  )
    throw new Error("AI_CONFLICT");
  return doc;
}
export function validateProposal(
  base: AiSnapshot,
  proposal: NonNullable<AiOutput["proposal"]>,
) {
  const assetRefs = (body: string) =>
    new Set([...body.matchAll(/asset:([a-f0-9]{64})/g)].map((m) => m[1]));
  const before = assetRefs(base.body),
    after = assetRefs(proposal.body);
  if (
    [...after].some((id) => !before.has(id)) ||
    [...before].some((id) => !after.has(id))
  )
    throw new Error("AI_IMAGE_REFERENCES");
  if (
    !proposal.title.trim() ||
    proposal.title.length > 300 ||
    proposal.body.length > 5_000_000
  )
    throw new Error("AI_PROPOSAL_FORMAT");
}
export async function applyAiProposal(
  base: AiSnapshot,
  proposal: NonNullable<AiOutput["proposal"]>,
) {
  assertCurrent(base);
  validateProposal(base, proposal);
  // Existing history save path creates a durable pre-AI snapshot before replacing the body.
  await store.flush();
  const doc = assertCurrent(base);
  await store.restoreHistory(
    snapshot(
      { ...doc, title: proposal.title, body: proposal.body },
      store.data.assets,
      Date.now(),
    ),
  );
  await store.flushRecovery();
}
export function lineDiff(before: string, after: string) {
  const old = before.split("\n"),
    next = after.split("\n");
  let head = 0;
  while (head < old.length && head < next.length && old[head] === next[head])
    head++;
  let tail = 0;
  while (
    tail < old.length - head &&
    tail < next.length - head &&
    old[old.length - 1 - tail] === next[next.length - 1 - tail]
  )
    tail++;
  return {
    unchangedBefore: head,
    unchangedAfter: tail,
    removed: old.slice(head, old.length - tail).join("\n"),
    added: next.slice(head, next.length - tail).join("\n"),
  };
}
