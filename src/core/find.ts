import type { Node } from "@tiptap/pm/model";
export type Match = { from: number; to: number };
export function textMatches(
  text: string,
  query: string,
  sensitive = false,
): Match[] {
  if (!query) return [];
  const pattern = new RegExp(
    query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    sensitive ? "gu" : "giu",
  );
  return Array.from(text.matchAll(pattern), (match) => ({
    from: match.index!,
    to: match.index! + match[0].length,
  }));
}
export function richMatches(
  doc: Node,
  query: string,
  sensitive = false,
): Match[] {
  const result: Match[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return;
    // A leaf placeholder prevents matches crossing an image or hard break.
    const text = node.textBetween(0, node.content.size, "\n", "\ufffc");
    result.push(
      ...textMatches(text, query, sensitive).map(({ from, to }) => ({
        from: pos + 1 + from,
        to: pos + 1 + to,
      })),
    );
    return false;
  });
  return result;
}
export function replaceMatches(
  text: string,
  matches: Match[],
  replacement: string,
) {
  const parts: string[] = [];
  let cursor = 0;
  for (const match of matches) {
    parts.push(text.slice(cursor, match.from), replacement);
    cursor = match.to;
  }
  parts.push(text.slice(cursor));
  return parts.join("");
}
