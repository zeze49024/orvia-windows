import { matchesShortcut } from "@/core/productivity";
import { store } from "@/core/storage";
import type { AiEditorBridge, AiSelectionRequest } from "@/core/ai-editor";
import { Slice } from "@tiptap/pm/model";
import { useEffect, useRef, useState } from "react";
import { closeHistory } from "@tiptap/pm/history";
import { EditorContent, ReactNodeViewRenderer, useEditor } from "@tiptap/react";
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
  Search,
  ChevronUp,
  ChevronDown,
  X,
} from "lucide-react";
import {
  editorExtensions,
  SafeImage,
  canEditRichly,
  setSourceHeading,
} from "@/core/editor";
import { translator, type MessageKey } from "@/i18n";
import type { Locale } from "@/core/model";
import { AssetNode } from "./editor-image";
import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { richMatches, textMatches, replaceMatches } from "@/core/find";
import { readPosition } from "@/core/writing-position";
import { useWritingPosition } from "@/hooks/use-writing-position";
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

const AssetImage = SafeImage.extend({
  addNodeView() {
    return ReactNodeViewRenderer(AssetNode);
  },
});

export function MarkdownEditor({
  searchRequest,
  documentId,
  value,
  onChange,
  locale,
  onImage,
  onImageFiles,
  busy,
  notify,
  onAi,
  onAiBridge,
}: {
  searchRequest?: { query: string; serial: number } | null;
  documentId: string;
  value: string;
  onChange: (value: string) => void;
  locale: Locale;
  onImage: (insert: (markdown: string) => void) => void;
  onImageFiles: (files: File[], insert: (markdown: string) => void) => void;
  busy: boolean;
  notify: (message: string) => void;
  onAi?: (
    action: AiSelectionRequest["action"],
    anchor: ReturnType<AiEditorBridge["capture"]>,
  ) => void;
  onAiBridge?: (bridge: AiEditorBridge | null) => void;
}) {
  const t = translator(locale),
    latest = useRef({ value, onChange, notify, t, busy });
  latest.current = { value, onChange, notify, t, busy };
  const root = useRef<HTMLDivElement>(null);
  const initialPosition = useRef(readPosition(documentId));
  const importImagesRef = useRef<(files: File[], position?: number) => void>(
    () => {},
  );
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [findOpen, setFindOpen] = useState(false),
    [replaceOpen, setReplaceOpen] = useState(false);
  const [query, setQuery] = useState(""),
    [replacement, setReplacement] = useState(""),
    [sensitive, setSensitive] = useState(false),
    [matchIndex, setMatchIndex] = useState(0);
  const searchInput = useRef<HTMLInputElement>(null);
  const searchState = useRef({ query, sensitive, matchIndex, findOpen });
  searchState.current = { query, sensitive, matchIndex, findOpen };
  const [source, setSource] = useState(
      value.length > 200_000 || initialPosition.current?.mode === "source",
    ),
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
    extensions: [
      ...editorExtensions(
        AssetImage,
        (text) => `${latest.current.t("task")}: ${text}`,
      ),
      Extension.create({
        name: "findHighlight",
        addProseMirrorPlugins: () => [
          new Plugin({
            props: {
              decorations: (state) => {
                const search = searchState.current;
                if (!search.findOpen || !search.query) return null;
                const matches = richMatches(
                  state.doc,
                  search.query,
                  search.sensitive,
                );
                const current =
                  matches[search.matchIndex % (matches.length || 1)];
                const shown = matches.slice(0, 2000);
                if (current && !shown.includes(current)) shown.push(current);
                return DecorationSet.create(
                  state.doc,
                  shown.map((match) =>
                    Decoration.inline(match.from, match.to, {
                      class:
                        match === current
                          ? "find-match find-current"
                          : "find-match",
                    }),
                  ),
                );
              },
            },
          }),
        ],
      }),
    ],
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
      handleDrop: (view, event, _slice, moved) => {
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (!files.length) return false;
        event.preventDefault();
        if (!moved && !latest.current.busy && !composing.current) {
          const pos = view.posAtCoords({
            left: event.clientX,
            top: event.clientY,
          })?.pos;
          importImagesRef.current(files, pos);
        }
        return true;
      },
      // Only explicit local files and plain text; HTML must never fetch remote images.
      handlePaste: (_view, event) => {
        if (latest.current.busy || composing.current) return true;
        const files = Array.from(event.clipboardData?.files ?? []);
        if (files.length) {
          event.preventDefault();
          importImagesRef.current(files);
          return true;
        }
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
  const [aiMenu, setAiMenu] = useState<{
    x: number;
    y: number;
    anchor: ReturnType<AiEditorBridge["capture"]>;
  } | null>(null);
  const aiBridge = useRef<AiEditorBridge | null>(null);
  useEffect(() => {
    const readRich = (from: number, to: number) => {
      if (!editor || editor.isDestroyed || !editor.markdown)
        throw new Error("AI_CONFLICT");
      return editor.markdown.serialize({
        type: "doc",
        content: editor.state.doc.slice(from, to).content.toJSON(),
      });
    };
    const bridge: AiEditorBridge = {
      capture() {
        if (composing.current) throw new Error("AI_CONFLICT");
        if (source) {
          const area = textarea.current;
          if (!area) throw new Error("AI_CONFLICT");
          return {
            kind: "source",
            from: area.selectionStart,
            to: area.selectionEnd,
            text: latest.current.value.slice(
              area.selectionStart,
              area.selectionEnd,
            ),
          };
        }
        if (!editor || editor.isDestroyed) throw new Error("AI_CONFLICT");
        const { from, to } = editor.state.selection;
        return { kind: "rich", from, to, text: readRich(from, to) };
      },
      preview(anchor, markdown, operation) {
        if (composing.current || anchor.kind !== (source ? "source" : "rich"))
          throw new Error("AI_CONFLICT");
        const from = operation === "insert" ? anchor.to : anchor.from;
        const to = anchor.to;
        if (source) {
          const body = latest.current.value;
          if (
            to > body.length ||
            (operation === "replace" &&
              body.slice(anchor.from, to) !== anchor.text)
          )
            throw new Error("AI_CONFLICT");
          return body.slice(0, from) + markdown + body.slice(to);
        }
        if (
          !editor ||
          editor.isDestroyed ||
          !editor.markdown ||
          to > editor.state.doc.content.size ||
          (operation === "replace" && readRich(anchor.from, to) !== anchor.text)
        )
          throw new Error("AI_CONFLICT");
        const parsed = editor.markdown.parse(markdown);
        if (!canEditRichly(markdown, editor.markdown.serialize(parsed)))
          throw new Error("AI_SOURCE_REQUIRED");
        const node = editor.schema.nodeFromJSON(parsed);
        const content =
          node.childCount === 1 && node.firstChild?.isTextblock
            ? new Slice(node.firstChild.content, 0, 0)
            : Slice.maxOpen(node.content);
        return editor.markdown.serialize(
          editor.state.tr.replaceRange(from, to, content).doc.toJSON(),
        );
      },
    };
    aiBridge.current = bridge;
    onAiBridge?.(bridge);
    return () => {
      aiBridge.current = null;
      onAiBridge?.(null);
    };
  }, [editor, source, onAiBridge]);
  useEffect(() => {
    if (!aiMenu) return;
    const close = (e: PointerEvent) => {
      if (!(e.target as Element).closest(".ai-selection-menu")) setAiMenu(null);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAiMenu(null);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", key);
    };
  }, [aiMenu]);
  useWritingPosition(
    documentId,
    editor,
    source,
    textarea,
    root,
    initialPosition.current,
  );
  useEffect(() => {
    editor?.setEditable(!busy, false);
  }, [editor, busy]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (
        root.current?.closest("[hidden]") ||
        document.querySelector('[role="dialog"], [role="alertdialog"]') ||
        event.isComposing ||
        composing.current
      )
        return;
      if (
        matchesShortcut(event, store.data.settings.shortcuts.find) ||
        matchesShortcut(event, store.data.settings.shortcuts.replace)
      ) {
        event.preventDefault();
        setFindOpen(true);
        setReplaceOpen(
          matchesShortcut(event, store.data.settings.shortcuts.replace),
        );
        requestAnimationFrame(() => {
          searchInput.current?.focus();
          searchInput.current?.select();
        });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  useEffect(() => {
    if (!editor || source || editor.isDestroyed) return;
    editor.view.dispatch(
      editor.state.tr
        .setMeta("findHighlight", true)
        .setMeta("addToHistory", false),
    );
  }, [editor, source, query, sensitive, matchIndex, findOpen]);
  const matches = source
    ? textMatches(value, query, sensitive)
    : editor
      ? richMatches(editor.state.doc, query, sensitive)
      : [];
  const currentIndex = matches.length ? matchIndex % matches.length : 0;
  const jump = (index: number) => {
    if (!matches.length) return;
    const next = (index + matches.length) % matches.length;
    setMatchIndex(next);
    const match = matches[next];
    if (source && textarea.current) {
      const area = textarea.current;
      area.setSelectionRange(match.from, match.to);
      const mirror = document.createElement("div"),
        style = getComputedStyle(area);
      for (const key of [
        "font",
        "lineHeight",
        "letterSpacing",
        "padding",
        "boxSizing",
        "tabSize",
        "overflowWrap",
        "wordBreak",
      ] as const)
        mirror.style[key] = style[key];
      Object.assign(mirror.style, {
        position: "absolute",
        visibility: "hidden",
        whiteSpace: "pre-wrap",
        width: `${area.clientWidth}px`,
      });
      mirror.append(document.createTextNode(area.value.slice(0, match.from)));
      const marker = document.createElement("span");
      marker.textContent = "|";
      mirror.append(marker);
      document.body.append(mirror);
      area.scrollTop = Math.max(0, marker.offsetTop - area.clientHeight / 2);
      mirror.remove();
      area.scrollIntoView({ block: "nearest" });
    } else editor?.chain().setTextSelection(match).scrollIntoView().run();
  };

  const requestedSearch = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!searchRequest?.query) return;
    requestedSearch.current = searchRequest.query;
    setQuery(searchRequest.query);
    setFindOpen(true);
  }, [searchRequest?.serial]);
  useEffect(() => {
    if (
      !editor ||
      !requestedSearch.current ||
      query !== requestedSearch.current ||
      !matches.length
    )
      return;
    const frame = requestAnimationFrame(() => {
      jump(0);
      requestedSearch.current = undefined;
    });
    return () => cancelAnimationFrame(frame);
  }, [editor, query, matches.length, source, searchRequest?.serial]);
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
  const insertImage = (
    provide: (insert: (markdown: string) => void) => void,
    position?: number,
  ) => {
    if (busy || composing.current || !editor) return;
    const from = textarea.current?.selectionStart ?? 0,
      to = textarea.current?.selectionEnd ?? from;
    const bookmark = editor.state.selection.getBookmark();
    provide((markdown) => {
      if (!mounted.current || editor.isDestroyed)
        throw new Error("DOCUMENT_CHANGED");
      if (source) {
        const current = latest.current.value;
        writeSource({
          value:
            current.slice(0, from) + "\n" + markdown + "\n" + current.slice(to),
          from: from + markdown.length + 2,
          to: from + markdown.length + 2,
        });
        requestAnimationFrame(() => {
          textarea.current?.focus();
          textarea.current?.setSelectionRange(
            from + markdown.length + 2,
            from + markdown.length + 2,
          );
        });
      } else {
        editor.view.dispatch(closeHistory(editor.state.tr));
        const selection = bookmark.resolve(editor.state.doc);
        editor
          .chain()
          .focus()
          .setTextSelection(
            position === undefined
              ? { from: selection.from, to: selection.to }
              : position,
          )
          .insertContent(markdown, { contentType: "markdown" })
          .run();
      }
    });
  };
  importImagesRef.current = (files, position) => {
    if (files.some((file) => !/\.(png|jpe?g|webp|gif)$/i.test(file.name))) {
      notify(t("imageFileOnly"));
      return;
    }
    insertImage((insert) => onImageFiles(files, insert), position);
  };
  const replaceFound = (all = false) => {
    if (busy || composing.current || !matches.length) return;
    const targets = all ? matches : [matches[currentIndex]];
    if (!source && targets.length > 5000) {
      notify(t("replaceLimit"));
      return;
    }
    if (source) {
      const next = replaceMatches(value, targets, replacement);
      if (next.length > 5_000_000) {
        notify(t("editorLimit"));
        return;
      }
      const end = targets[0].from + replacement.length;
      writeSource({ value: next, from: end, to: end });
    } else if (editor) {
      editor.view.dispatch(closeHistory(editor.state.tr));
      let tr = editor.state.tr;
      for (let i = targets.length - 1; i >= 0; i--)
        tr = tr.insertText(replacement, targets[i].from, targets[i].to);
      // Apply the entire replacement as one undoable transaction.
      const markdown = editor.markdown!.serialize(tr.doc.toJSON());
      if (markdown.length > 5_000_000) {
        notify(t("editorLimit"));
        return;
      }
      editor.view.dispatch(tr);
      editor.view.dispatch(closeHistory(editor.state.tr));
    }
    setMatchIndex(0);
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
      onClick={() => {
        if (source && name !== "undo" && name !== "redo")
          sourceFormat(...fallback);
        else {
          if (editor && name !== "undo" && name !== "redo")
            editor.view.dispatch(closeHistory(editor.state.tr));
          action();
        }
      }}
    >
      <Icon size={16} />
    </button>
  );

  return (
    <div
      className="markdown-editor"
      ref={root}
      onContextMenu={(e) => {
        if (
          !onAi ||
          busy ||
          composing.current ||
          !(e.target as Element).closest(".source-editor,.live-editor")
        )
          return;
        try {
          const anchor = aiBridge.current?.capture();
          if (anchor && anchor.to > anchor.from && anchor.text.trim()) {
            e.preventDefault();
            setAiMenu({
              x: Math.max(8, Math.min(e.clientX, innerWidth - 230)),
              y: Math.max(8, Math.min(e.clientY, innerHeight - 300)),
              anchor,
            });
          }
        } catch {
          notify(t("aiConflict"));
        }
      }}
    >
      {aiMenu && (
        <div
          className="ai-selection-menu"
          role="menu"
          aria-label={t("aiSelectedMenu")}
          style={{ left: aiMenu.x, top: aiMenu.y }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <button
            role="menuitem"
            onClick={() => {
              void navigator.clipboard
                .writeText(aiMenu.anchor.text)
                .then(() => notify(t("aiCopied")))
                .catch(() => notify(t("failed")));
              setAiMenu(null);
            }}
          >
            {t("aiCopy")}
          </button>
          <span>{t("aiTitle")}</span>
          {(["ask", "polish", "expand", "summarize", "translate"] as const).map(
            (action) => (
              <button
                key={action}
                role="menuitem"
                onClick={() => {
                  onAi?.(action, aiMenu.anchor);
                  setAiMenu(null);
                }}
              >
                {t(
                  (
                    {
                      ask: "aiAskSelection",
                      polish: "aiPolishSelection",
                      expand: "aiExpandSelection",
                      summarize: "aiSummarizeSelection",
                      translate: "aiTranslateSelection",
                    } as const
                  )[action],
                )}
              </button>
            ),
          )}
        </div>
      )}
      <div
        className="format-bar live-format-bar"
        inert={busy}
        role="toolbar"
        aria-label={t("formatToolbar")}
        onClickCapture={(event) => {
          if (composing.current) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
      >
        <div
          className="editor-capsule format-capsule"
          role="group"
          aria-label={t("formatGroup")}
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
              // Each explicit heading choice is one undo step, even if choices
              // arrive within ProseMirror's normal typing group interval.
              if (!source && editor)
                editor.view.dispatch(closeHistory(editor.state.tr));
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
          <span className="toolbar-divider" aria-hidden="true" />
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
          <span className="toolbar-divider" aria-hidden="true" />
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
          <span className="toolbar-divider" aria-hidden="true" />
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
          <span className="toolbar-divider" aria-hidden="true" />
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
            onClick={() => insertImage(onImage)}
          >
            <ImagePlus size={16} />
          </button>
          <span className="toolbar-divider" aria-hidden="true" />
          <Button
            variant="ghost"
            size="sm"
            className="editor-mode"
            aria-label={t(source ? "liveEdit" : "sourceMode")}
            title={t(source ? "liveEdit" : "sourceMode")}
            aria-pressed={source}
            onClick={toggleSource}
          >
            {t(source ? "liveEditShort" : "sourceModeShort")}
          </Button>
        </div>
        <button
          className="find-launch"
          type="button"
          aria-label={t("findReplace")}
          title={`${t("findReplace")} · ${store.data.settings.shortcuts.find} / ${store.data.settings.shortcuts.replace}`}
          onClick={() => {
            setFindOpen((open) => !open);
            setReplaceOpen(true);
            requestAnimationFrame(() => searchInput.current?.focus());
          }}
        >
          <Search size={17} />
        </button>
        <div
          className="editor-capsule history-capsule"
          role="group"
          aria-label={t("historyGroup")}
        >
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
        </div>
      </div>
      {findOpen && (
        <section
          className="find-bar"
          aria-label={t("findReplace")}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setFindOpen(false);
              if (source) textarea.current?.focus();
              else editor?.commands.focus();
            }
            if (e.key === "Enter" && e.target === searchInput.current) {
              e.preventDefault();
              jump(currentIndex + (e.shiftKey ? -1 : 1));
            }
          }}
        >
          <div className="find-row">
            <Input
              ref={searchInput}
              aria-label={t("findText")}
              placeholder={t("findText")}
              maxLength={200}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setMatchIndex(0);
              }}
            />
            <span className="find-count" role="status">
              {query
                ? matches.length
                  ? `${currentIndex + 1} / ${matches.length}`
                  : t("noMatches")
                : "0 / 0"}
            </span>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("previousMatch")}
              disabled={!matches.length}
              onClick={() => jump(currentIndex - 1)}
            >
              <ChevronUp size={17} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("nextMatch")}
              disabled={!matches.length}
              onClick={() => jump(currentIndex + 1)}
            >
              <ChevronDown size={17} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label={t("matchCase")}
              aria-pressed={sensitive}
              onClick={() => setSensitive(!sensitive)}
            >
              Aa
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setReplaceOpen(!replaceOpen)}
            >
              {t("replace")}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("closeFind")}
              onClick={() => setFindOpen(false)}
            >
              <X size={17} />
            </Button>
          </div>
          {replaceOpen && (
            <div className="find-row">
              <Input
                aria-label={t("replaceWith")}
                placeholder={t("replaceWith")}
                value={replacement}
                maxLength={10000}
                onChange={(e) => setReplacement(e.target.value)}
              />
              <Button
                variant="outline"
                size="sm"
                disabled={busy || !matches.length}
                onClick={() => replaceFound()}
              >
                {t("replace")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busy || !matches.length}
                onClick={() => replaceFound(true)}
              >
                {t("replaceAll")}
              </Button>
            </div>
          )}
        </section>
      )}
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
          readOnly={busy}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files);
            if (files.length) {
              e.preventDefault();
              importImagesRef.current(files);
            }
          }}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes("Files")) e.preventDefault();
          }}
          onDrop={(e) => {
            if (e.dataTransfer.files.length) {
              e.preventDefault();
              importImagesRef.current(Array.from(e.dataTransfer.files));
            }
          }}
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
