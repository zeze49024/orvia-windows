import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { safeFilename, type Workspace } from "./model";
import { getAsset } from "./storage";

export async function exportMarkdownDocument(data: Workspace, id: string) {
  const doc = data.documents.find((item) => item.id === id && !item.deletedAt);
  if (!doc) throw new Error("DOCUMENT_NOT_FOUND");
  const tree = unified().use(remarkParse).use(remarkGfm).parse(doc.body);
  const replacements: {
    start: number;
    end: number;
    url: string;
    id: string;
  }[] = [];
  type Node = {
    type?: string;
    url?: string;
    children?: Node[];
    position?: { start: { offset?: number }; end: { offset?: number } };
  };
  const visit = (node: Node) => {
    const assetId = node.url?.match(/^asset:([a-f0-9]{64})$/)?.[1];
    if (
      assetId &&
      ["image", "definition"].includes(node.type ?? "") &&
      node.position
    )
      replacements.push({
        start: node.position.start.offset!,
        end: node.position.end.offset!,
        url: node.url!,
        id: assetId,
      });
    node.children?.forEach(visit);
  };
  visit(tree);
  const urls = new Map<string, string>();
  for (const ref of replacements) {
    if (urls.has(ref.id)) continue;
    const asset = data.assets.find((item) => item.id === ref.id);
    if (!asset) throw new Error("MISSING_ASSET");
    const bytes = await getAsset(asset),
      chunks: string[] = [];
    for (let i = 0; i < bytes.length; i += 8192)
      chunks.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
    urls.set(ref.id, `data:${asset.mime};base64,${btoa(chunks.join(""))}`);
  }
  let body = doc.body;
  for (const ref of replacements.sort((a, b) => b.start - a.start)) {
    const part = body
      .slice(ref.start, ref.end)
      .replace(ref.url, urls.get(ref.id)!);
    if (body.length + part.length - (ref.end - ref.start) > 128 * 1024 * 1024)
      throw new Error("EXPORT_TOO_LARGE");
    body = body.slice(0, ref.start) + part + body.slice(ref.end);
  }
  return {
    name: safeFilename(doc.title.replace(/\.md$/i, "")) + ".md",
    bytes: new TextEncoder().encode(body),
  };
}
