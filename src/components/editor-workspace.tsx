import { DocumentOutline } from "@/components/document-outline";
import { LocalImage } from "@/components/local-image";
import { MarkdownEditor } from "@/components/markdown-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { type Document, type Locale } from "@/core/model";
import { formatTime, translator } from "@/i18n";
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  Eye,
  FileText,
  Search,
  Star,
  Trash2,
  X,
} from "lucide-react";
import React, { useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { DocumentOptions } from "./document-options";

import type { Library, Workspace } from "@/core/model";
export function EditorWorkspace({
  active,
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
  removed,
  setModal,
  importFiles,
  busy,
  iconButton,
}: {
  active: Document;
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
  removed: (d: Document) => void;
  setModal: (s: string) => void;
  importFiles: (v?: boolean, insert?: (markdown: string) => void) => void;
  busy: boolean;
  iconButton: (
    Icon: typeof Search,
    label: string,
    action: () => void,
  ) => React.ReactNode;
}) {
  const t = translator(locale),
    paper = useRef<HTMLElement>(null);
  return (
    <>
      <div className="editor-toolbar">
        <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
          <ArrowLeft size={15} />
          {t("back")}
        </Button>
        <span className="muted editor-save">
          <CheckCircle2 size={13} />
          {saveLabel}
        </span>
        <div className="flex-spacer" />
        <DocumentOptions
          doc={active}
          libraries={data.libraries}
          locale={locale}
          patch={patch}
          notify={notify}
        />
        {iconButton(Star, t("star"), () =>
          patch(active.id, { starred: !active.starred }),
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => setPreview(!preview)}
        >
          <Eye size={14} />
          {t(preview ? "edit" : "preview")}
        </Button>
        {iconButton(Download, t("export"), () => markdownExport(active.id))}
        {iconButton(Trash2, t(active.deletedAt ? "restore" : "remove"), () =>
          removed(active),
        )}
        {active.deletedAt && iconButton(X, t("purge"), () => setModal("purge"))}
      </div>
      <div className="editor-layout">
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
                  img: ({ src, alt }) => <LocalImage src={src} alt={alt} />,
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
              key={active.id}
              value={active.body}
              locale={locale}
              onChange={(body) => patch(active.id, { body })}
              onImage={(insert) => importFiles(true, insert)}
              busy={busy}
              notify={notify}
            />
          )}
        </article>
        <DocumentOutline body={active.body} locale={locale} paper={paper} />
      </div>
    </>
  );
}
