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
