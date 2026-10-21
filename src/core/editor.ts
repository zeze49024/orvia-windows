import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import Image from "@tiptap/extension-image";
import { TaskList, TaskItem } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";

// Never put an untrusted Markdown URL into an image src, including during paste.
// The React node view resolves only verified workspace assets to blob URLs.
export const SafeImage = Image.extend({
  renderHTML({ node }) {
    return [
      "span",
      { "data-image-source": node.attrs.src },
      node.attrs.alt || "Image",
    ];
  },
});

export function editorExtensions(
  image = SafeImage,
  taskLabel = (text: string) => text || "Task",
) {
  return [
    StarterKit.configure({
      underline: false,
      link: {
        openOnClick: false,
        autolink: false,
        linkOnPaste: false,
        isAllowedUri: (url) => /^https?:\/\//i.test(url),
      },
    }),
    TaskList,
    TaskItem.configure({
      nested: true,
      a11y: { checkboxLabel: (node) => taskLabel(node.textContent) },
    }),
    TableKit.configure({ table: { resizable: false } }),
    image,
    Markdown,
  ];
}

const parser = unified().use(remarkParse).use(remarkGfm);

export function documentOutline(markdown: string) {
  const headings: { level: number; text: string; offset: number }[] = [];
  type Item = {
    type?: string;
    value?: string;
    alt?: string | null;
    depth?: number;
    children?: Item[];
    position?: { start: { offset?: number } };
  };
  const text = (node: Item): string =>
    node.value ?? node.alt ?? node.children?.map(text).join("") ?? "";
  const visit = (node: Item) => {
    if (node.type === "heading")
      headings.push({
        level: node.depth!,
        text: text(node),
        offset: node.position?.start.offset ?? 0,
      });
    else node.children?.forEach(visit);
  };
  visit(parser.parse(markdown));
  return headings;
}

export function setSourceHeading(
  value: string,
  start: number,
  end: number,
  level: number,
) {
  const from = start === 0 ? 0 : value.lastIndexOf("\n", start - 1) + 1;
  const next = value.indexOf("\n", Math.max(start, end - 1));
  const to = next === -1 ? value.length : next;
  const selected = value
    .slice(from, to)
    .split("\n")
    .map((line) => {
      const heading = /^ {0,3}#{1,6}(?:\s+|$)/.test(line);
      let body = line.replace(/^ {0,3}#{1,6}(?:[\t ]+|$)/, "");
      if (heading) body = body.replace(/[\t ]+#+[\t ]*$/, "");
      return (level ? "#".repeat(level) + " " : "") + body;
    })
    .join("\n");
  return {
    value: value.slice(0, from) + selected + value.slice(to),
    from,
    to: from + selected.length,
  };
}
function semanticTree(markdown: string) {
  return JSON.stringify(parser.parse(markdown), (key, value) =>
    // These fields describe source layout, not document content.
    ["position", "spread"].includes(key) ? undefined : value,
  );
}

// Unsupported syntax stays in source mode instead of silently disappearing when
// a rich-text transaction serializes the whole document. Opening never writes.
export function canEditRichly(original: string, serialized: string) {
  if (original === serialized) return true;
  return semanticTree(original) === semanticTree(serialized);
}
