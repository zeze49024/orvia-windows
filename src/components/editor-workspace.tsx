import type { Confirm } from "@/hooks/use-confirmation";
import { AiPanel } from "./ai-panel";
import type { AiEditorBridge, AiSelectionRequest } from "@/core/ai-editor";
import { DocumentOutline } from "@/components/document-outline";
import { LocalImage } from "@/components/local-image";
import { MarkdownEditor } from "@/components/markdown-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { type Document, type Locale } from "@/core/model";
import { formatTime, translator } from "@/i18n";
import {
  Sparkles,
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  LoaderCircle,
  FileDown,
  Download,
  Eye,
  FileText,
  Trash2,
  X,
} from "lucide-react";
import { useRef, useState, useCallback, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { DocumentOptions } from "./document-options";
import { FavoriteButton } from "./favorite-button";

import type { Library, Workspace } from "@/core/model";
export function EditorWorkspace({
  searchRequest,
  active,
  confirm,
  data,
  locale,
  library,
  saveLabel,
  preview,
  setPreview,
  setSelected,
  patch,
  notify,
  markdownExport,
  pdfExport,
  saveState,
  retrySave,
  removed,
  setModal,
  importFiles,
  busy,
  run,
  suspended,
  configureAi,
}: {
  searchRequest: { id: string; query: string; serial: number } | null;
  active: Document;
  confirm: Confirm;
  data: Workspace;
  locale: Locale;
  library: Library | undefined;
  saveLabel: string;
  preview: boolean;
  setPreview: (v: boolean) => void;
  setSelected: (v: string | null) => void;
  patch: (id: string, p: Partial<Document>) => void;
  notify: (s: string) => void;
  markdownExport: (id: string) => void;
  pdfExport: (id: string) => void;
  saveState: string;
  retrySave: () => void;
  removed: (d: Document) => void;
  setModal: (s: string) => void;
  importFiles: (
    v?: boolean,
    insert?: (markdown: string) => void,
    folder?: boolean,
    files?: File[],
  ) => void;
  busy: boolean;
  run: (action: () => Promise<void>) => Promise<void>;
  suspended: boolean;
  configureAi: () => void;
}) {
  const t = translator(locale),
    paper = useRef<HTMLElement>(null);
  const [aiOpen, setAiOpen] = useState(false),
    [expanded, setExpanded] = useState(false),
    [aiSeed, setAiSeed] = useState<AiSelectionRequest | null>(null);
  const aiBridge = useRef<AiEditorBridge | null>(null),
    serial = useRef(0);
  const registerAiBridge = useCallback((next: AiEditorBridge | null) => {
    aiBridge.current = next;
  }, []);
  const openAi = (
    action: AiSelectionRequest["action"] = "ask",
    anchor?: ReturnType<AiEditorBridge["capture"]>,
  ) => {
    if (busy || active.deletedAt) return;
    try {
      const target = anchor || aiBridge.current?.capture();
      setAiSeed(
        target && target.to > target.from
          ? {
              serial: ++serial.current,
              action,
              anchor: target,
              body: active.body,
            }
          : null,
      );
      setAiOpen(true);
    } catch {
      notify(t("aiConflict"));
    }
  };
  useEffect(() => {
    if (suspended) setAiOpen(false);
  }, [suspended]);
  return (
    <>
      <div className="editor-toolbar">
        <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
          <ArrowLeft size={15} />
          {t("back")}
        </Button>
        <span className="muted editor-save">
          {saveState === "error" ? (
            <AlertCircle size={14} className="save-error-icon" />
          ) : saveState === "saving" ? (
            <LoaderCircle size={14} className="save-spinner" />
          ) : (
            <CheckCircle2 size={14} />
          )}
          {saveLabel}
          {saveState === "error" && (
            <button type="button" className="save-retry" onClick={retrySave}>
              {t("retry")}
            </button>
          )}
        </span>
        <div className="flex-spacer" />
        <Button
          className="action-ai"
          variant="ghost"
          size="sm"
          disabled={busy || !!active.deletedAt}
          aria-label={t("aiTitle")}
          title={t("aiTitle")}
          onClick={() => openAi()}
        >
          <Sparkles size={17} />
          AI
        </Button>
        <DocumentOptions
          confirm={confirm}
          doc={active}
          libraries={data.libraries}
          locale={locale}
          patch={patch}
          notify={notify}
        />
        <FavoriteButton
          starred={active.starred}
          label={t("star")}
          onClick={() => patch(active.id, { starred: !active.starred })}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => setPreview(!preview)}
        >
          <Eye size={14} />
          {t(preview ? "edit" : "preview")}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="action-export"
          aria-label={t("export")}
          title={t("export")}
          onClick={() => markdownExport(active.id)}
        >
          <Download size={18} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="action-export"
          aria-label={t("exportPdf")}
          title={t("exportPdf")}
          disabled={busy || !!active.deletedAt}
          onClick={() => pdfExport(active.id)}
        >
          <FileDown size={17} />
          PDF
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={active.deletedAt ? "action-restore" : "action-danger"}
          aria-label={t(active.deletedAt ? "restore" : "remove")}
          title={t(active.deletedAt ? "restore" : "remove")}
          onClick={() => removed(active)}
        >
          <Trash2 size={18} />
        </Button>
        {active.deletedAt && (
          <Button
            variant="ghost"
            size="icon"
            className="action-danger"
            aria-label={t("purge")}
            title={t("purge")}
            onClick={() => setModal("purge")}
          >
            <X size={18} />
          </Button>
        )}
      </div>
      <div
        className={`editor-layout ${aiOpen ? "ai-layout" : ""} ${aiOpen && expanded ? "ai-expanded" : ""}`}
      >
        <article className="editor-paper" ref={paper}>
          <div className="document-filename">
            <FileText size={14} />
            <span>{t("filename")}</span>
            <input
              className="document-title"
              aria-label={t("title")}
              maxLength={300}
              readOnly={preview || !!active.deletedAt}
              value={active.title}
              onChange={(e) => patch(active.id, { title: e.target.value })}
            />
          </div>
          <div className="doc-meta">
            <span>{formatTime(active.updatedAt, locale)}</span>
            <span>·</span>
            <span>
              {active.body.length} {t("chars")}
            </span>
            <div className="tag-row">
              {active.tags.map((tag) => (
                <Badge variant="secondary" key={tag}>
                  {tag}
                </Badge>
              ))}
            </div>
          </div>
          {preview || active.deletedAt ? (
            <div className="reading">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                urlTransform={(url) =>
                  url.startsWith("asset:")
                    ? url
                    : /^https?:\/\//i.test(url)
                      ? url
                      : ""
                }
                components={{
                  img: ({ src, alt, title }) => (
                    <LocalImage src={src} alt={alt} title={title} />
                  ),
                  a: ({ href, children }) => (
                    <button
                      className="markdown-link"
                      title={href}
                      onClick={() =>
                        notify(t("blockedLink") + " " + (href ?? ""))
                      }
                    >
                      {children}
                    </button>
                  ),
                }}
              >
                {active.body}
              </ReactMarkdown>
            </div>
          ) : (
            <MarkdownEditor
              searchRequest={
                searchRequest?.id === active.id ? searchRequest : null
              }
              key={active.id}
              documentId={active.id}
              value={active.body}
              locale={locale}
              onChange={(body) => patch(active.id, { body })}
              onImage={(insert) => importFiles(true, insert)}
              onImageFiles={(files, insert) =>
                importFiles(true, insert, false, files)
              }
              busy={busy}
              notify={notify}
              onAi={openAi}
              onAiBridge={registerAiBridge}
            />
          )}
        </article>
        {aiOpen && !suspended ? (
          <aside className="ai-dock">
            <AiPanel
              doc={active}
              locale={locale}
              confirm={confirm}
              notify={notify}
              run={run}
              bridge={() => aiBridge.current}
              seed={aiSeed}
              expanded={expanded}
              onExpand={() => setExpanded(!expanded)}
              onClose={() => setAiOpen(false)}
              onConfigure={configureAi}
            />
          </aside>
        ) : (
          <DocumentOutline body={active.body} locale={locale} paper={paper} />
        )}
      </div>
    </>
  );
}
