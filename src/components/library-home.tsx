import { useEffect, useState } from "react";
import { ContextMenu } from "radix-ui";
import {
  CheckSquare,
  MoveRight,
  Pin,
  PinOff,
  Trash2,
  Download,
  Share2,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { updateDocuments } from "@/core/batch";
import { Button } from "@/components/ui/button";
import {
  APP_VERSION,
  newDocument,
  type Document,
  type Locale,
} from "@/core/model";
import { formatTime, translator, type MessageKey } from "@/i18n";
import {
  ArrowDownToLine,
  ArrowUpRight,
  BookOpen,
  Clock3,
  FileText,
  LayoutGrid,
  List,
  Plus,
  Search,
  ShieldCheck,
} from "lucide-react";

import type { Workspace } from "@/core/model";
import { FavoriteButton } from "./favorite-button";
export function LibraryHome({
  data,
  page,
  pageName,
  query,
  setQuery,
  busy,
  setLibraryId,
  setModal,
  newDialog,
  docsAlive,
  thisWeek,
  recents,
  openDoc,
  sort,
  setSort,
  change,
  visible,
  patch,
  removed,
  locale,
  setSelected,
  batchExport,
}: {
  batchExport: (ids: string[], format: "files" | "zip" | "share") => void;
  data: Workspace;
  page: string;
  pageName: string;
  query: string;
  setQuery: (s: string) => void;
  busy: boolean;
  setLibraryId: (s: string) => void;
  setModal: (s: string) => void;
  newDialog: () => void;
  docsAlive: Document[];
  thisWeek: number;
  recents: Document[];
  openDoc: (id: string) => void;
  sort: string;
  setSort: (s: string) => void;
  change: (fn: (s: Workspace) => Workspace) => void;
  visible: Document[];
  patch: (id: string, p: Partial<Document>) => void;
  removed: (d: Document) => void;
  locale: Locale;
  setSelected: (id: string | null) => void;
}) {
  const t = translator(locale);
  const [selection, setSelection] = useState<string[] | null>(null),
    [action, setAction] = useState("");
  const visibleIds = new Set(visible.map((d) => d.id));
  const ids = (selection ?? []).filter((id) => visibleIds.has(id));
  const selectedIds = new Set(ids);
  const byId = new Map(data.documents.map((d) => [d.id, d]));
  useEffect(() => {
    setSelection(null);
    setAction("");
  }, [page, query]);
  const allPinned = ids.length > 0 && ids.every((id) => byId.get(id)?.pinned);
  useEffect(() => {
    if (selection === null) return;
    const handler = (e: KeyboardEvent) => {
      if (
        e.isComposing ||
        (e.target instanceof Element &&
          e.target.closest(
            'input,textarea,[contenteditable="true"],[role="dialog"]',
          ))
      )
        return;
      if (
        document.querySelector('[role="dialog"],[role="menu"],.settings-page')
      )
        return;
      if (e.key === "Escape") setSelection(null);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSelection(visible.map((d) => d.id));
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selection, visible]);
  const toggle = (id: string) =>
    setSelection((s) =>
      s?.includes(id) ? s.filter((v) => v !== id) : [...(s ?? []), id],
    );
  const apply = (patch: Parameters<typeof updateDocuments>[2]) => {
    change((s) => updateDocuments(s, ids, patch));
    setSelection(null);
    setAction("");
  };

  return (
    <div className="page-content">
      <div className="page-intro">
        <div>
          <h1>
            {pageName}
            <span className="heading-dot">.</span>
          </h1>
          <p>{t("intro")}</p>
        </div>
        <div className="page-actions">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              setLibraryId(
                data.libraries.some((l) => l.id === page)
                  ? page
                  : data.libraries[0].id,
              );
              setModal("import");
            }}
          >
            <ArrowDownToLine size={15} />
            {t("import")}
          </Button>
          <Button onClick={newDialog}>
            <Plus size={16} />
            {t("new")}
          </Button>
        </div>
      </div>
      {page === "all" && (
        <>
          <div className="home-search">
            <Search size={18} />
            <input
              aria-label={t("search")}
              placeholder={t("queryHint")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <kbd>Ctrl K</kbd>
          </div>
          {!query && selection === null && recents.length > 0 && (
            <>
              <div className="section-heading">
                <h2>
                  <Clock3 size={16} />
                  {t("continue")}
                </h2>
                <span>{t("recentHint")}</span>
              </div>
              <div className="continue-grid">
                {recents.map((d, i) => (
                  <button
                    key={d.id}
                    className="continue-card"
                    onClick={() => openDoc(d.id)}
                  >
                    <div className={`mini-cover cover-${i}`}>
                      <i />
                      <i />
                      <i />
                      <FileText size={25} />
                    </div>
                    <div>
                      <span className="continue-category">
                        {data.libraries.find((l) => l.id === d.libraryId)?.name}
                        <span>·</span>
                        {formatTime(d.updatedAt, locale)}
                      </span>
                      <h3>
                        {d.pinned && <Pin size={14} aria-label={t("pin")} />}{" "}
                        {d.title || t("write")}
                      </h3>
                      <p>{d.body.slice(0, 90)}</p>
                    </div>
                    <ArrowUpRight size={17} />
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      )}
      {page === "all" && !query && (
        <div className="compact-overview" aria-label={t("overview")}>
          <span>
            {t("all")} <b>{docsAlive.length}</b>
          </span>
          <span>
            {t("libraryCount")} <b>{data.libraries.length}</b>
          </span>
          <span>
            {t("week")} <b>{thisWeek}</b>
          </span>
        </div>
      )}
      <div className="document-section">
        <div className="document-heading">
          <h2>
            {t(query ? "results" : page === "trash" ? "deleted" : "documents")}
            <span>{visible.length}</span>
          </h2>
          <div className="document-controls">
            <div className="inline-search">
              <Search size={14} />
              <input
                aria-label={t("filter")}
                placeholder={t("filter")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <select
              aria-label={t("sort")}
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="updated">{t("updated")}</option>
              <option value="az">{t("az")}</option>
              <option value="oldest">{t("oldest")}</option>
            </select>
            <div className="view-toggle">
              {[
                { key: "grid", icon: LayoutGrid },
                { key: "list", icon: List },
              ].map((view) => (
                <button
                  key={view.key}
                  aria-label={t(view.key as MessageKey)}
                  aria-pressed={data.settings.layout === view.key}
                  className={
                    data.settings.layout === view.key ? "selected" : ""
                  }
                  onClick={() =>
                    change((s) => ({
                      ...s,
                      settings: {
                        ...s.settings,
                        layout: view.key as "grid" | "list",
                      },
                    }))
                  }
                >
                  <view.icon size={15} />
                </button>
              ))}
            </div>
          </div>
        </div>
        {selection !== null && (
          <div className="batch-bar">
            <label>
              <input
                type="checkbox"
                aria-label={t("selectAll")}
                checked={visible.length > 0 && ids.length === visible.length}
                onChange={() =>
                  setSelection(
                    ids.length === visible.length
                      ? []
                      : visible.map((d) => d.id),
                  )
                }
              />
              {t("selectedCount")} <b>{ids.length}</b>
            </label>
            <div
              className="editor-capsule batch-capsule"
              role="group"
              aria-label={t("multiSelect")}
            >
              <Button
                variant="ghost"
                disabled={!ids.length || busy}
                onClick={() => setAction("move")}
              >
                <MoveRight />
                {t("moveTo")}
              </Button>
              <Button
                variant="ghost"
                disabled={!ids.length || busy}
                onClick={() => apply({ pinned: !allPinned })}
              >
                {allPinned ? <PinOff /> : <Pin />}
                {t(allPinned ? "unpin" : "pin")}
              </Button>
              <Button
                variant="ghost"
                className="danger-action"
                disabled={!ids.length || busy}
                onClick={() => apply({ deletedAt: new Date().toISOString() })}
              >
                <Trash2 />
                {t("delete")}
              </Button>
              <span className="toolbar-divider" />
              <Button
                variant="ghost"
                disabled={!ids.length || busy}
                onClick={() => setAction("export")}
              >
                <Download />
                {t("export")}
              </Button>
              <Button
                variant="ghost"
                disabled={!ids.length || busy}
                onClick={() => setAction("share")}
              >
                <Share2 />
                {t("share")}
              </Button>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("exitSelection")}
              onClick={() => setSelection(null)}
            >
              <X size={17} />
            </Button>
          </div>
        )}
        <Dialog open={!!action} onOpenChange={(open) => !open && setAction("")}>
          <DialogContent closeLabel={t("close")}>
            <DialogHeader>
              <DialogTitle>
                {t(
                  action === "move"
                    ? "moveTo"
                    : action === "share"
                      ? "share"
                      : "exportChoice",
                )}
              </DialogTitle>
              <DialogDescription>
                {t("selectedCount")} {ids.length}
              </DialogDescription>
            </DialogHeader>
            {action === "move" ? (
              <div className="move-targets">
                {data.libraries.map((l) => (
                  <Button
                    key={l.id}
                    variant="outline"
                    onClick={() => apply({ libraryId: l.id })}
                  >
                    {l.name}
                  </Button>
                ))}
              </div>
            ) : (
              <div className="modal-stack">
                <p>{t(action === "share" ? "shareHint" : "exportFilesHint")}</p>
                {action === "share" ? (
                  <Button
                    disabled={busy}
                    onClick={() => {
                      batchExport(ids, "share");
                      setAction("");
                    }}
                  >
                    {t("downloadFile")}
                  </Button>
                ) : (
                  <>
                    <Button
                      disabled={busy}
                      onClick={() => {
                        batchExport(ids, "files");
                        setAction("");
                      }}
                    >
                      {t("exportFiles")}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        batchExport(ids, "zip");
                        setAction("");
                      }}
                    >
                      {t("exportZip")}
                    </Button>
                  </>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>
        <div className={`documents ${data.settings.layout}`}>
          {visible.map((d) => {
            const lib = data.libraries.find((l) => l.id === d.libraryId)!;
            return (
              <ContextMenu.Root key={d.id}>
                <ContextMenu.Trigger asChild disabled={!!d.deletedAt}>
                  <div
                    className={`document-card ${selectedIds.has(d.id) ? "card-selected" : ""}`}
                  >
                    {selection !== null && (
                      <label className="card-checkbox">
                        <input
                          type="checkbox"
                          aria-label={t("multiSelect") + " " + d.title}
                          checked={selectedIds.has(d.id)}
                          onChange={() => toggle(d.id)}
                        />
                      </label>
                    )}

                    <button
                      className="card-main"
                      onClick={() =>
                        selection !== null ? toggle(d.id) : openDoc(d.id)
                      }
                    >
                      <div className="card-top">
                        <span className={`file-icon ${lib.color}`}>
                          <FileText size={19} />
                        </span>
                        <span className="card-category">{lib.name}</span>
                      </div>
                      <h3>
                        {d.pinned && <Pin size={14} aria-label={t("pin")} />}{" "}
                        {d.title || t("write")}
                      </h3>
                      <p>
                        {d.body.replace(/[#*>`\[\]]/g, "").slice(0, 120) ||
                          t("write")}
                      </p>
                      <div className="tag-row">
                        {d.tags.map((tag, i) => (
                          <span
                            className={`tag ${i === 0 ? lib.color : "gray"}`}
                            key={tag}
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </button>
                    <div className="card-footer">
                      <span>
                        <Clock3 size={12} />
                        {formatTime(d.updatedAt, locale)}
                      </span>
                      {d.deletedAt ? (
                        <button
                          aria-label={t("restore") + " " + d.title}
                          onClick={() => removed(d)}
                        >
                          {t("restore")}
                        </button>
                      ) : (
                        <FavoriteButton
                          starred={d.starred}
                          label={t("star") + " " + d.title}
                          onClick={() => patch(d.id, { starred: !d.starred })}
                        />
                      )}
                    </div>
                  </div>
                </ContextMenu.Trigger>
                <ContextMenu.Portal>
                  <ContextMenu.Content className="heading-menu note-context">
                    <ContextMenu.Item
                      className="heading-menu-item"
                      onSelect={() => setSelection([d.id])}
                    >
                      <CheckSquare size={16} />
                      {t("multiSelect")}
                    </ContextMenu.Item>
                    <ContextMenu.Item
                      className="heading-menu-item danger-action"
                      onSelect={() => {
                        change((s) =>
                          updateDocuments(s, [d.id], {
                            deletedAt: new Date().toISOString(),
                          }),
                        );
                        setSelection(
                          (v) => v?.filter((id) => id !== d.id) ?? null,
                        );
                      }}
                    >
                      <Trash2 size={16} />
                      {t("delete")}
                    </ContextMenu.Item>
                  </ContextMenu.Content>
                </ContextMenu.Portal>
              </ContextMenu.Root>
            );
          })}
        </div>
        {visible.length === 0 && (
          <div className="empty">
            <BookOpen size={32} />
            <h3>{t("empty")}</h3>
            <p>{t("emptyHint")}</p>
            <div className="empty-actions">
              <Button
                variant="outline"
                onClick={() => (query ? setQuery("") : newDialog())}
              >
                {t(query ? "clear" : "new")}
              </Button>
              {!query && page === "all" && (
                <Button
                  variant="outline"
                  onClick={() => {
                    const doc = newDocument(
                      data.libraries[0].id,
                      t("welcome"),
                      t("welcomeBody"),
                    );
                    change((s) => ({
                      ...s,
                      documents: [doc, ...s.documents],
                    }));
                    setSelected(doc.id);
                  }}
                >
                  {t("addWelcome")}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
      <div className="bottom-note">
        <ShieldCheck size={13} />
        {t("footer")}
        <span>ORVIA / v{APP_VERSION}</span>
      </div>
    </div>
  );
}
