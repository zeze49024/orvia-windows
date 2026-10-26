import { z } from "zod";

export const aiAnchorSchema = z
  .object({
    kind: z.enum(["source", "rich"]),
    from: z.number().int().nonnegative(),
    to: z.number().int().nonnegative(),
    text: z.string().max(240000),
  })
  .strict()
  .refine((a) => a.to >= a.from);
export type AiAnchor = z.infer<typeof aiAnchorSchema>;
export const chatMessageSchema = z
  .object({
    id: z.string().uuid(),
    role: z.enum(["user", "assistant"]),
    content: z.string().max(240000),
    createdAt: z.string().datetime(),
    quote: z.string().max(64000).optional(),
    proposal: z
      .object({ title: z.string().max(300), body: z.string().max(240000) })
      .strict()
      .optional(),
    scope: z.enum(["selection", "note", "none"]).optional(),
    fingerprint: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    anchor: aiAnchorSchema.optional(),
    applied: z.boolean().optional(),
    usage: z
      .object({
        input: z.number().nonnegative(),
        output: z.number().nonnegative(),
        requests: z.number().int().min(1).max(4),
      })
      .strict()
      .optional(),
  })
  .strict();
export const conversationSchema = z
  .object({
    id: z.string().uuid(),
    documentId: z.string().uuid(),
    title: z.string().min(1).max(100),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    messages: z.array(chatMessageSchema).max(80),
  })
  .strict();
export const conversationsSchema = z
  .array(conversationSchema)
  .max(40)
  .superRefine((items, ctx) => {
    if (
      new Set(items.map((c) => c.id)).size !== items.length ||
      items.some(
        (c) => new Set(c.messages.map((m) => m.id)).size !== c.messages.length,
      )
    )
      ctx.addIssue({ code: "custom", message: "AI_HISTORY_DUPLICATE" });
    if (
      new TextEncoder().encode(JSON.stringify(items)).length >
      4 * 1024 * 1024
    )
      ctx.addIssue({ code: "custom", message: "AI_HISTORY_LIMIT" });
  });
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export type AiConversation = z.infer<typeof conversationSchema>;
export type AiScope = "selection" | "note" | "none";
export type AiTurn = { role: "user" | "assistant"; content: string };
export function conversationContext(
  messages: ChatMessage[],
  budget: number,
): AiTurn[] {
  const result: AiTurn[] = [];
  let used = 0;
  for (const m of messages.slice(-20).reverse()) {
    const content = [
      m.quote ? `Quoted data:\n${m.quote}` : "",
      m.content,
      m.proposal
        ? `Suggested text (not an executed action):\n${m.proposal.body}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    const size = [...content].length;
    if (used + size > budget) break;
    result.unshift({ role: m.role, content });
    used += size;
  }
  return result;
}
