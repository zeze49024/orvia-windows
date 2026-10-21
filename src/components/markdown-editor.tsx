import { useEffect, useRef, useState } from "react";
import {
  EditorContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  useEditor,
  type NodeViewProps,
} from "@tiptap/react";
import {
  Bold,
  Italic,
  Heading2,
  ListTodo,
  Link,
  Code2,
  ImagePlus,
  Undo2,
  Redo2,
  List,
  ListOrdered,
  Quote,
  Table,
  CodeSquare,
} from "lucide-react";
import { editorExtensions, SafeImage, canEditRichly } from "@/core/editor";
import { translator, type MessageKey } from "@/i18n";
import type { Locale } from "@/core/model";
import { LocalImage } from "./local-image";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";

function AssetNode({ node }: NodeViewProps) {
  return (
    <NodeViewWrapper className="editor-image" contentEditable={false}>
      <LocalImage src={node.attrs.src} alt={node.attrs.alt} />
    </NodeViewWrapper>
  );
}
const AssetImage = SafeImage.extend({
  addNodeView() {
    return ReactNodeViewRenderer(AssetNode);
  },
});

export function MarkdownEditor({
  value,
  onChange,
  locale,
  onImage,
  busy,
  notify,
}: {
  value: string;
  onChange: (value: string) => void;
  locale: Locale;
  onImage: () => void;
  busy: boolean;
  notify: (message: string) => void;
}) {
  const t = translator(locale),
    latest = useRef({ value, onChange, notify, t });
  latest.current = { value, onChange, notify, t };
  const [source, setSource] = useState(false),
    [guarded, setGuarded] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false),
    [href, setHref] = useState("");
  const [, refresh] = useState(0),
    textarea = useRef<HTMLTextAreaElement>(null);
  const lastEmitted = useRef(value);
  const editor = useEditor({
    extensions: editorExtensions(
      AssetImage,
      (text) => `${latest.current.t("task")}: ${text}`,
    ),
    content: value,
    contentType: "markdown",
    editorProps: {
      attributes: {
        class: "reading live-editor",
        role: "textbox",
        "aria-multiline": "true",
      },
      handleClick: (_view, _pos, event) => {
        if ((event.target as HTMLElement).closest("a")) {
          event.preventDefault();
          latest.current.notify(latest.current.t("blockedLink"));
          return true;
        }
        return false;
      },
      // Paste text only: HTML clipboard images must never initiate remote requests.
      handlePaste: (_view, event) => {
        const text = event.clipboardData?.getData("text/plain");
        if (!text) return true;
        const ed = editorRef.current;
        if (!ed?.markdown) return true;
        event.preventDefault();
        const parsed = ed.markdown.parse(text);
        if (canEditRichly(text, ed.markdown.serialize(parsed)))
          ed.commands.insertContent(text, { contentType: "markdown" });
        else ed.commands.insertContent({ type: "text", text });
        return true;
      },
    },
    onTransaction: () => refresh((n) => n + 1),
    onUpdate: ({ editor: ed }) => {
      const markdown = ed.getMarkdown();
      if (markdown.length > 5_000_000) {
        ed.commands.setContent(latest.current.value, {
          contentType: "markdown",
          emitUpdate: false,
        });
        latest.current.notify(latest.current.t("editorLimit"));
        return;
      }
      lastEmitted.current = markdown;
      latest.current.onChange(markdown);
    },
  });
  const editorRef = useRef(editor);
  editorRef.current = editor;

  useEffect(() => {
    if (!editor) return;
    // Sync external changes (e.g. image import); do not reset selection/history
    // for our own keystrokes or for metadata/save-status re-renders.
    if (value !== lastEmitted.current) {
      editor.commands.setContent(value, {
        contentType: "markdown",
        emitUpdate: false,
      });
      lastEmitted.current = value;
    }
    const safe = canEditRichly(value, editor.getMarkdown());
    setGuarded(!safe);
    if (!safe) setSource(true);
  }, [editor, value]);
  useEffect(() => {
    editor?.view.dom.setAttribute("aria-label", t("body"));
    editor?.view.dom.setAttribute("data-placeholder", t("write"));
  }, [editor, locale]);

  const sourceFormat = (before: string, after = "") => {
    const el = textarea.current;
    if (!el) return;
    const start = el.selectionStart,
      end = el.selectionEnd;
    const next =
      value.slice(0, start) +
      before +
      value.slice(start, end) +
      after +
      value.slice(end);
    if (next.length > 5_000_000) return;
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + before.length, end + before.length);
    });
  };
  const toggleSource = () => {
    if (source && guarded) {
      notify(t("sourcePreserved"));
      return;
    }
    setSource(!source);
  };
  const command = (
    name: MessageKey,
    fallback: [string, string],
    action: () => void,
    active = false,
    Icon = Bold,
    disabled = false,
  ) => (
    <button
      type="button"
      key={name}
      aria-label={t(name)}
      title={t(name)}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => (source ? sourceFormat(...fallback) : action())}
    >
      <Icon size={16} />
    </button>
  );

  return (
    <div className="markdown-editor">
      <div
        className="format-bar live-format-bar"
        role="toolbar"
        aria-label={t("formatToolbar")}
      >
        {command(
          "heading",
          ["## ", ""],
          () => {
            editor?.chain().focus().toggleHeading({ level: 2 }).run();
          },
          editor?.isActive("heading") ?? false,
          Heading2,
        )}
        {command(
          "bold",
          ["**", "**"],
          () => {
            editor?.chain().focus().toggleBold().run();
          },
          editor?.isActive("bold") ?? false,
          Bold,
        )}
        {command(
          "italic",
          ["*", "*"],
          () => {
            editor?.chain().focus().toggleItalic().run();
          },
          editor?.isActive("italic") ?? false,
          Italic,
        )}
        {command(
          "bulletList",
          ["- ", ""],
          () => {
            editor?.chain().focus().toggleBulletList().run();
          },
          editor?.isActive("bulletList") ?? false,
          List,
        )}
        {command(
          "orderedList",
          ["1. ", ""],
          () => {
            editor?.chain().focus().toggleOrderedList().run();
          },
          editor?.isActive("orderedList") ?? false,
          ListOrdered,
        )}
        {command(
          "task",
          ["- [ ] ", ""],
          () => {
            editor?.chain().focus().toggleTaskList().run();
          },
          editor?.isActive("taskList") ?? false,
          ListTodo,
        )}
        {command(
          "quote",
          ["> ", ""],
          () => {
            editor?.chain().focus().toggleBlockquote().run();
          },
          editor?.isActive("blockquote") ?? false,
          Quote,
        )}
        {command(
          "link",
          ["[", "](https://)"],
          () => {
            setHref(editor?.getAttributes("link").href ?? "https://");
            setLinkOpen(true);
          },
          editor?.isActive("link") ?? false,
          Link,
        )}
        {command(
          "code",
          ["`", "`"],
          () => {
            editor?.chain().focus().toggleCode().run();
          },
          editor?.isActive("code") ?? false,
          Code2,
        )}
        {command(
          "codeBlock",
          ["\n```\n", "\n```\n"],
          () => {
            editor?.chain().focus().toggleCodeBlock().run();
          },
          editor?.isActive("codeBlock") ?? false,
          CodeSquare,
        )}
        {command(
          "insertTable",
          ["\n| A | B |\n| --- | --- |\n|  |  |\n", ""],
          () => {
            editor
              ?.chain()
              .focus()
              .insertTable({ rows: 3, cols: 2, withHeaderRow: true })
              .run();
          },
          false,
          Table,
        )}
        <button
          aria-label={t("image")}
          title={t("image")}
          disabled={busy}
          onMouseDown={(e) => e.preventDefault()}
          onClick={onImage}
        >
          <ImagePlus size={16} />
        </button>
        {command(
          "undo",
          ["", ""],
          () => {
            editor?.chain().focus().undo().run();
          },
          false,
          Undo2,
          source || !editor?.can().undo(),
        )}
        {command(
          "redo",
          ["", ""],
          () => {
            editor?.chain().focus().redo().run();
          },
          false,
          Redo2,
          source || !editor?.can().redo(),
        )}
        <Button
          variant="ghost"
          size="sm"
          className="editor-mode"
          aria-pressed={source}
          onClick={toggleSource}
        >
          {t(source ? "liveEdit" : "sourceMode")}
        </Button>
      </div>
      {guarded && (
        <p className="editor-notice" role="status">
          {t("sourcePreserved")}
        </p>
      )}
      <p className="editor-hint">{t(source ? "sourceHint" : "liveHint")}</p>
      {source ? (
        <textarea
          ref={textarea}
          className="editor-textarea source-editor"
          aria-label={t("body")}
          maxLength={5_000_000}
          value={value}
          placeholder={t("write")}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
        />
      ) : (
        <EditorContent editor={editor} />
      )}
      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("link")}</DialogTitle>
            <DialogDescription>{t("linkHint")}</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            aria-label={t("linkUrl")}
            value={href}
            onChange={(e) => setHref(e.target.value)}
          />
          <div className="modal-actions">
            <Button
              variant="outline"
              onClick={() => {
                editor
                  ?.chain()
                  .focus()
                  .extendMarkRange("link")
                  .unsetLink()
                  .run();
                setLinkOpen(false);
              }}
            >
              {t("removeLink")}
            </Button>
            <Button
              disabled={!/^https?:\/\/\S+$/i.test(href)}
              onClick={() => {
                editor
                  ?.chain()
                  .focus()
                  .extendMarkRange("link")
                  .setLink({ href })
                  .run();
                setLinkOpen(false);
              }}
            >
              {t("save")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
