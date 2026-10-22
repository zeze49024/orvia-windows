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
import {
  editorExtensions,
  SafeImage,
  canEditRichly,
  setSourceHeading,
} from "@/core/editor";
import { translator, type MessageKey } from "@/i18n";
import type { Locale } from "@/core/model";
import { LocalImage } from "./local-image";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { HeadingMenu } from "./ui/heading-menu";
import { SourceHistory, type SourceSnapshot } from "@/core/source-history";
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
  onImage: (insert: (markdown: string) => void) => void;
  busy: boolean;
  notify: (message: string) => void;
}) {
  const t = translator(locale),
    latest = useRef({ value, onChange, notify, t });
  latest.current = { value, onChange, notify, t };
  const [source, setSource] = useState(value.length > 200_000),
    [guarded, setGuarded] = useState(false);
  const [sourceLevel, setSourceLevel] = useState(0);
  const [linkOpen, setLinkOpen] = useState(false),
    [href, setHref] = useState("");
  const [, refresh] = useState(0),
    textarea = useRef<HTMLTextAreaElement>(null);
  const lastEmitted = useRef(value);
  const sourceValue = useRef(value);
  const sourceHistory = useRef(new SourceHistory());
  const composing = useRef(false);
  const sourceComposition = useRef<SourceSnapshot | null>(null);
  const sourceSelection = useRef({ from: 0, to: 0 });
  const editor = useEditor({
    extensions: editorExtensions(
      AssetImage,
      (text) => `${latest.current.t("task")}: ${text}`,
    ),
    content: value.length > 200_000 ? "" : value,
    contentType: "markdown",
    editorProps: {
      attributes: {
        class: "reading live-editor",
        role: "textbox",
        "aria-multiline": "true",
      },
      handleDOMEvents: {
        blur: () => {
          const ed = editorRef.current;
          if (composing.current && ed && !ed.isDestroyed) {
            composing.current = false;
            const markdown = ed.getMarkdown();
            if (markdown.length <= 5_000_000) {
              lastEmitted.current = markdown;
              latest.current.onChange(markdown);
            }
          }
          return false;
        },
        compositionstart: () => {
          composing.current = true;
          return false;
        },
        compositionend: () => {
          composing.current = false;
          // Let ProseMirror finish its final composition transaction first.
          setTimeout(() => {
            const ed = editorRef.current;
            if (!ed || ed.isDestroyed || composing.current) return;
            const markdown = ed.getMarkdown();
            if (
              markdown !== lastEmitted.current &&
              markdown.length <= 5_000_000
            ) {
              lastEmitted.current = markdown;
              latest.current.onChange(markdown);
            }
          }, 0);
          return false;
        },
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
        if (ed.isActive("codeBlock") || ed.isActive("code")) {
          ed.view.dispatch(ed.state.tr.insertText(text));
          return true;
        }
        const parsed = ed.markdown.parse(text);
        if (canEditRichly(text, ed.markdown.serialize(parsed)))
          ed.commands.insertContent(text, { contentType: "markdown" });
        else ed.view.dispatch(ed.state.tr.insertText(text));
        return true;
      },
    },
    onTransaction: () => refresh((n) => n + 1),
    onUpdate: ({ editor: ed }) => {
      if (composing.current) return;
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
    if (source) {
      // Source keystrokes must not rebuild the hidden rich editor or its undo stack.
      if (value !== sourceValue.current) sourceHistory.current.reset();
      sourceValue.current = value;
      return;
    }
    // Sync external changes (e.g. image import); do not reset selection/history
    // for our own keystrokes or for metadata/save-status re-renders.
    const external = value !== lastEmitted.current;
    if (value.length > 200_000) {
      sourceValue.current = value;
      setSource(true);
      return;
    }
    if (external) {
      editor.commands.setContent(value, {
        contentType: "markdown",
        emitUpdate: false,
      });
      lastEmitted.current = value;
    }
    if (!external && editor.isFocused) return;
    const safe = canEditRichly(value, editor.getMarkdown());
    setGuarded(!safe);
    if (!safe) {
      sourceValue.current = value;
      setSource(true);
    }
  }, [editor, value, source]);
  useEffect(() => {
    editor?.view.dom.setAttribute("aria-label", t("body"));
    editor?.view.dom.setAttribute("data-placeholder", t("write"));
  }, [editor, locale]);

  const snapshot = (): SourceSnapshot => ({
    value: latest.current.value,
    ...sourceSelection.current,
  });
  const writeSource = (next: SourceSnapshot, group = false) => {
    if (next.value.length > 5_000_000) return;
    sourceHistory.current.record(snapshot(), next, group);
    sourceSelection.current = { from: next.from, to: next.to };
    sourceValue.current = next.value;
    latest.current.onChange(next.value);
  };
  const restoreSource = (redo = false) => {
    const next = redo
      ? sourceHistory.current.redo(snapshot())
      : sourceHistory.current.undo(snapshot());
    if (!next) return;
    sourceValue.current = next.value;
    sourceSelection.current = { from: next.from, to: next.to };
    latest.current.onChange(next.value);
    requestAnimationFrame(() => {
      textarea.current?.focus();
      textarea.current?.setSelectionRange(next.from, next.to);
    });
  };
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
    writeSource({
      value: next,
      from: start + before.length,
      to: end + before.length,
    });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + before.length, end + before.length);
    });
  };
  const toggleSource = () => {
    if (composing.current || !editor) return;
    sourceHistory.current.boundary();
    if (source) {
      if (value.length > 200_000) {
        notify(t("longDocumentSource"));
        return;
      }
      const parsed = editor.markdown!.parse(value);
      if (!canEditRichly(value, editor.markdown!.serialize(parsed))) {
        setGuarded(true);
        notify(t("sourcePreserved"));
        return;
      }
      setGuarded(false);
    } else {
      if (sourceValue.current !== value) sourceHistory.current.reset();
      sourceValue.current = value;
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
      onClick={() =>
        source && name !== "undo" && name !== "redo"
          ? sourceFormat(...fallback)
          : action()
      }
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
        onClickCapture={(event) => {
          if (composing.current) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
      >
        <HeadingMenu
          value={
            source
              ? sourceLevel
              : editor?.isActive("heading")
                ? editor.getAttributes("heading").level
                : 0
          }
          label={t("heading")}
          paragraph={t("paragraph")}
          onChange={(level) => {
            if (source && textarea.current) {
              const el = textarea.current;
              const result = setSourceHeading(
                value,
                el.selectionStart,
                el.selectionEnd,
                level,
              );
              if (result.value.length > 5_000_000) return;
              setSourceLevel(level);
              writeSource({
                value: result.value,
                from: result.from,
                to: result.to,
              });
              requestAnimationFrame(() => {
                el.focus();
                el.setSelectionRange(result.from, result.to);
              });
            } else if (level)
              editor
                ?.chain()
                .focus()
                .setHeading({ level: level as 1 | 2 | 3 | 4 | 5 | 6 })
                .run();
            else editor?.chain().focus().setParagraph().run();
          }}
        />
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
          onClick={() => {
            const from = textarea.current?.selectionStart ?? 0,
              to = textarea.current?.selectionEnd ?? from;
            const bookmark = editor?.state.selection.getBookmark();
            onImage((markdown) => {
              if (source) {
                const current = latest.current.value;
                writeSource({
                  value:
                    current.slice(0, from) +
                    "\n" +
                    markdown +
                    "\n" +
                    current.slice(to),
                  from,
                  to: from + markdown.length + 2,
                });
              } else if (editor && bookmark) {
                const selection = bookmark.resolve(editor.state.doc);
                editor
                  .chain()
                  .focus()
                  .setTextSelection({ from: selection.from, to: selection.to })
                  .insertContent(markdown, { contentType: "markdown" })
                  .run();
              }
            });
          }}
        >
          <ImagePlus size={16} />
        </button>
        {command(
          "undo",
          ["", ""],
          () => {
            if (source) restoreSource();
            else editor?.chain().focus().undo().run();
          },
          false,
          Undo2,
          source ? !sourceHistory.current.canUndo : !editor?.can().undo(),
        )}
        {command(
          "redo",
          ["", ""],
          () => {
            if (source) restoreSource(true);
            else editor?.chain().focus().redo().run();
          },
          false,
          Redo2,
          source ? !sourceHistory.current.canRedo : !editor?.can().redo(),
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
      {source && value.length > 200_000 && (
        <p className="editor-notice" role="status">
          {t("longDocumentSource")}
        </p>
      )}
      {source ? (
        <textarea
          ref={textarea}
          className="editor-textarea source-editor"
          aria-label={t("body")}
          maxLength={5_000_000}
          value={value}
          placeholder={t("write")}
          onCompositionStart={() => {
            composing.current = true;
            sourceComposition.current = snapshot();
          }}
          onCompositionEnd={(e) => {
            composing.current = false;
            if (sourceComposition.current) {
              sourceHistory.current.record(sourceComposition.current, {
                value: e.currentTarget.value,
                from: e.currentTarget.selectionStart,
                to: e.currentTarget.selectionEnd,
              });
              sourceComposition.current = null;
              refresh((n) => n + 1);
            }
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing || composing.current) return;
            if (
              (e.ctrlKey || e.metaKey) &&
              ["z", "y"].includes(e.key.toLowerCase())
            ) {
              e.preventDefault();
              restoreSource(e.key.toLowerCase() === "y" || e.shiftKey);
            }
          }}
          onChange={(e) => {
            const el = e.currentTarget;
            const next = {
              value: el.value,
              from: el.selectionStart,
              to: el.selectionEnd,
            };
            if (composing.current) {
              sourceValue.current = next.value;
              onChange(next.value);
            } else writeSource(next, true);
          }}
          onSelect={(e) => {
            const el = e.currentTarget,
              start = el.selectionStart;
            sourceSelection.current = { from: start, to: el.selectionEnd };
            const from = start ? el.value.lastIndexOf("\n", start - 1) + 1 : 0;
            setSourceLevel(
              /^ {0,3}(#{1,6})(?:[\t ]+|$)/.exec(
                el.value.slice(from).split("\n")[0],
              )?.[1].length ?? 0,
            );
          }}
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
