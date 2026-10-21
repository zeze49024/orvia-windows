import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { putAsset } from "./storage";
import { imageMime } from "./image-mime";
import type { Asset } from "./model";

/** Resolve embedded images only in Markdown image destinations, never code/HTML. */
export async function importMarkdownImages(body: string, signal: AbortSignal) {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(body);
  type Node = {
    type: string;
    url?: string;
    identifier?: string;
    children?: Node[];
    position?: { start: { offset?: number }; end: { offset?: number } };
  };
  const nodes: Node[] = [],
    references = new Set<string>();
  const walk = (node: Node) => {
    if (node.type === "imageReference" && node.identifier)
      references.add(node.identifier);
    nodes.push(node);
    node.children?.forEach(walk);
  };
  walk(tree as Node);
  const assets = new Map<string, Asset>(),
    urls = new Map<string, string>();
  const replacements: {
    start: number;
    end: number;
    from: string;
    to: string;
  }[] = [];
  let total = 0;
  for (const node of nodes) {
    if (
      node.type !== "image" &&
      !(node.type === "definition" && references.has(node.identifier!))
    )
      continue;
    if (!node.url?.startsWith("data:")) continue;
    signal.throwIfAborted();
    if (!urls.has(node.url)) {
      const match =
        /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]*={0,2})$/.exec(
          node.url,
        );
      if (
        !match ||
        match[2].length % 4 ||
        match[2].length > Math.ceil((20 * 1024 * 1024) / 3) * 4
      )
        throw new Error("INVALID_EMBEDDED_IMAGE");
      const bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));
      total += bytes.length;
      if (total > 96 * 1024 * 1024 || imageMime(bytes) !== match[1])
        throw new Error("INVALID_EMBEDDED_IMAGE");
      const asset = await putAsset(bytes, imageMime(bytes));
      assets.set(asset.id, asset);
      urls.set(node.url, "asset:" + asset.id);
    }
    replacements.push({
      start: node.position!.start.offset!,
      end: node.position!.end.offset!,
      from: node.url,
      to: urls.get(node.url)!,
    });
  }
  for (const ref of replacements.sort((a, b) => b.start - a.start)) {
    body =
      body.slice(0, ref.start) +
      body.slice(ref.start, ref.end).replace(ref.from, ref.to) +
      body.slice(ref.end);
  }
  return { body, assets: [...assets.values()] };
}
