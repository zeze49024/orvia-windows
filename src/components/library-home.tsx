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
  Star,
} from "lucide-react";

import type { Workspace } from "@/core/model";
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
}: {
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
          {!query && recents.length > 0 && (
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
                      <h3>{d.title || t("write")}</h3>
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
        <div className={`documents ${data.settings.layout}`}>
          {visible.map((d) => {
            const lib = data.libraries.find((l) => l.id === d.libraryId)!;
            return (
              <div className="document-card" key={d.id}>
                <button className="card-main" onClick={() => openDoc(d.id)}>
                  <div className="card-top">
                    <span className={`file-icon ${lib.color}`}>
                      <FileText size={19} />
                    </span>
                    <span className="card-category">{lib.name}</span>
                  </div>
                  <h3>{d.title || t("write")}</h3>
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
                    <button
                      aria-label={t("star") + " " + d.title}
                      onClick={() => patch(d.id, { starred: !d.starred })}
                    >
                      <Star
                        size={14}
                        fill={d.starred ? "#e9af43" : "none"}
                        color={d.starred ? "#d6a33c" : "#b5b7bf"}
                      />
                    </button>
                  )}
                </div>
              </div>
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
