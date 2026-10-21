import React, { useEffect, useReducer, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowUpRight,
  ArrowLeft,
  ArrowDownToLine,
  ArrowUpFromLine,
  Search,
  Plus,
  BookOpen,
  Files,
  Star,
  Clock3,
  Trash2,
  Settings,
  ChevronDown,
  ChevronRight,
  PanelLeft,
  LayoutGrid,
  List,
  HardDrive,
  ShieldCheck,
  Check,
  FileText,
  Folder,
  X,
  Minus,
  Square,
  Bell,
  PencilLine,
  Eye,
  CircleHelp,
  CheckCircle2,
  AlertCircle,
  ImagePlus,
  Download,
  RefreshCw,
  MoreHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  APP_VERSION,
  RELEASE_NOTE,
  colors,
  newDocument,
  safeFilename,
  type Document,
  type Asset,
  type Locale,
} from "@/core/model";
import { store, native } from "@/core/storage";
import { chooseFiles, saveFile } from "@/core/files";
import { convertFile } from "@/core/import";
import {
  createBackup,
  exportMarkdown,
  inspectBackup,
  importBackup,
  mergeAssets,
} from "@/core/backup";
import { checkUpdate, installUpdate } from "@/core/updates";
import {
  translator,
  languageRegistry,
  formatTime,
  type MessageKey,
} from "@/i18n";
import type { Update } from "@tauri-apps/plugin-updater";
import { LocalImage } from "@/components/local-image";
import { MarkdownEditor } from "@/components/markdown-editor";
import { DocumentOutline } from "@/components/document-outline";
import "./styles.css";
import "./workspace.css";
import "./application.css";

function App() {
  const [, redraw] = useReducer((n) => n + 1, 0),
    [page, setPage] = useState("all"),
    [query, setQuery] = useState(""),
    [selected, setSelected] = useState<string | null>(null),
    [modal, setModal] = useState(""),
    [toast, setToast] = useState(""),
    [preview, setPreview] = useState(false),
    [sort, setSort] = useState("updated");
  const [newTitle, setNewTitle] = useState(""),
    [libraryId, setLibraryId] = useState(""),
    [libraryName, setLibraryName] = useState(""),
    [libraryColor, setLibraryColor] = useState<(typeof colors)[number]>("blue"),
    [editingLibrary, setEditingLibrary] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [job, setJob] = useState(""),
    [restoreBytes, setRestoreBytes] = useState<Uint8Array | null>(null),
    [restoreCount, setRestoreCount] = useState(0),
    [update, setUpdate] = useState<Update | null>(null),
    [progress, setProgress] = useState(0),
    [updateMessage, setUpdateMessage] = useState("");
  const paper = useRef<HTMLElement>(null);
  const cancelRef = useRef<AbortController | null>(null),
    toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    busyRef = useRef(false);
  const data = store.data,
    locale = data.settings.locale,
    t = translator(locale),
    active = data.documents.find((d) => d.id === selected),
    library = data.libraries.find((l) => l.id === active?.libraryId);
  const notify = (message: string) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 6000);
  };
  const error = (e: unknown) => {
    const message = String(e);
    notify(
      (message.includes("CONFLICT") ? t("conflict") : t("failed")) +
        " · " +
        message.replace(/^Error: /, "").slice(0, 140),
    );
  };
  const run = async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await action();
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) error(e);
    } finally {
      busyRef.current = false;
      setBusy(false);
      setJob("");
      cancelRef.current = null;
    }
  };
  useEffect(() => store.subscribe(redraw), []);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = "Orvia v" + APP_VERSION;
  }, [locale]);
  useEffect(() => {
    void store.load();
    return () => clearTimeout(toastTimer.current);
  }, []);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setModal("search");
      }
      if ((e.ctrlKey || e.metaKey) && e.key === ",") {
        e.preventDefault();
        setModal("settings");
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void store.flush().catch(error);
      }
    };
    const unload = (e: BeforeUnloadEvent) => {
      if (store.dirty || busyRef.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("keydown", handler);
    window.addEventListener("beforeunload", unload);
    return () => {
      window.removeEventListener("keydown", handler);
      window.removeEventListener("beforeunload", unload);
    };
  }, [locale]);
  useEffect(() => {
    if (!native) return;
    let cleanup: (() => void) | undefined,
      disposed = false;
    void import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
      const win = getCurrentWindow(),
        off = await win.onCloseRequested(async (event) => {
          event.preventDefault();
          if (busyRef.current) {
            notify(t("working"));
            return;
          }
          try {
            await store.flush();
            await win.destroy();
          } catch {
            notify(t("saveFirst"));
          }
        });
      if (disposed) off();
      else cleanup = off;
    });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [locale]);
  const change = (fn: Parameters<typeof store.change>[0]) => {
    try {
      store.change(fn);
    } catch (e) {
      error(e);
    }
  };
  const patch = (id: string, patch: Partial<Document>) =>
    change((s) => ({
      ...s,
      documents: s.documents.map((d) =>
        d.id === id
          ? { ...d, ...patch, updatedAt: new Date().toISOString() }
          : d,
      ),
    }));
  const openDoc = (id: string) => {
    setSelected(id);
    setPreview(false);
    change((s) => ({
      ...s,
      documents: s.documents.map((d) =>
        d.id === id ? { ...d, openedAt: new Date().toISOString() } : d,
      ),
    }));
  };
  const navigate = (name: string) => {
    setPage(name);
    setSelected(null);
    setQuery("");
  };
  const newDialog = () => {
    setLibraryId(
      data.libraries.some((l) => l.id === page) ? page : data.libraries[0].id,
    );
    setModal("new");
  };
  const create = () => {
    if (!newTitle.trim()) return;
    const doc = newDocument(libraryId || data.libraries[0].id, newTitle.trim());
    change((s) => ({ ...s, documents: [doc, ...s.documents] }));
    setSelected(doc.id);
    setNewTitle("");
    setPage("all");
    setModal("");
    notify(t("created"));
  };
  const visible = data.documents
    .filter((d) => Boolean(d.deletedAt) === (page === "trash"))
    .filter((d) =>
      page === "starred"
        ? d.starred
        : page === "recent"
          ? !!d.openedAt
          : data.libraries.some((l) => l.id === page)
            ? d.libraryId === page
            : true,
    )
    .filter((d) =>
      (d.title + d.body + d.tags.join(" "))
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
    )
    .sort((a, b) =>
      sort === "az"
        ? a.title.localeCompare(b.title, locale)
        : sort === "oldest"
          ? a.createdAt.localeCompare(b.createdAt)
          : page === "recent"
            ? (b.openedAt ?? "").localeCompare(a.openedAt ?? "")
            : b.updatedAt.localeCompare(a.updatedAt),
    );
  const recents = data.documents
      .filter((d) => !d.deletedAt && d.openedAt)
      .sort((a, b) => (b.openedAt ?? "").localeCompare(a.openedAt ?? ""))
      .slice(0, 2),
    pageName =
      data.libraries.find((l) => l.id === page)?.name ??
      t(
        (["all", "recent", "starred", "trash"].includes(page)
          ? page
          : "all") as MessageKey,
      ),
    saveLabel =
      store.status === "saving"
        ? t("saving")
        : store.status === "error"
          ? t("saveError")
          : t("saved"),
    docsAlive = data.documents.filter((d) => !d.deletedAt),
    thisWeek = docsAlive.filter(
      (d) => Date.now() - Date.parse(d.updatedAt) < 7 * 86400000,
    ).length;
  const bytesUsed =
      new TextEncoder().encode(JSON.stringify(data)).length +
      data.assets.reduce((n, a) => n + a.size, 0),
    sizeLabel =
      new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(
        bytesUsed / 1024 / 1024,
      ) + " MB";
  const iconButton = (
    Icon: typeof Search,
    label: string,
    action: () => void,
  ) => (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      onClick={action}
    >
      <Icon size={16} />
    </Button>
  );
  const windowAction = async (
    action: "minimize" | "toggleMaximize" | "close",
  ) => {
    if (!native) return;
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow()[action]();
    } catch (e) {
      error(e);
    }
  };
  const exportBackup = () =>
    run(async () => {
      if (
        await saveFile(
          `Orvia-${new Date().toISOString().slice(0, 10)}.orvia`,
          await createBackup(structuredClone(store.data)),
          ["orvia"],
        )
      )
        notify(t("exported"));
    });
  const markdownExport = (id?: string) =>
    run(async () => {
      if (
        await saveFile(
          (id ? safeFilename(active?.title ?? "Orvia") : "Orvia") +
            "-markdown.zip",
          await exportMarkdown(structuredClone(store.data), id),
          ["zip"],
        )
      )
        notify(t("exported"));
    });
  const restoreSelect = () =>
    run(async () => {
      const files = await chooseFiles(["orvia", "zip"], false);
      if (!files.length) return;
      const result = await inspectBackup(files[0].bytes);
      setRestoreBytes(files[0].bytes);
      setRestoreCount(result.data.documents.length);
      setModal("restore");
    });
  const restore = () =>
    run(async () => {
      if (!restoreBytes) return;
      const next = await importBackup(store.data, restoreBytes);
      store.change(() => next);
      await store.flush();
      setRestoreBytes(null);
      setModal("");
      notify(t("restoredBackup"));
    });
  const importFiles = (imagesOnly = false) =>
    run(async () => {
      const controller = new AbortController();
      cancelRef.current = controller;
      const files = await chooseFiles(
        imagesOnly
          ? ["png", "jpg", "jpeg", "webp", "gif"]
          : [
              "md",
              "markdown",
              "txt",
              "docx",
              "pdf",
              "png",
              "jpg",
              "jpeg",
              "webp",
              "gif",
            ],
      );
      if (!files.length) return;
      const documents: Document[] = [],
        assets: Asset[] = [];
      let insert = "";
      for (let i = 0; i < files.length; i++) {
        setJob(`${i + 1}/${files.length} · ${files[i].name}`);
        const result = await convertFile(files[i], controller.signal);
        assets.push(...result.assets);
        if (imagesOnly && active) insert += "\n\n" + result.body;
        else
          documents.push(
            newDocument(
              libraryId || data.libraries[0].id,
              result.title,
              result.body,
            ),
          );
      }
      controller.signal.throwIfAborted();
      store.change((s) => ({
        ...s,
        assets: mergeAssets(s.assets, assets),
        documents:
          insert && active
            ? s.documents.map((d) =>
                d.id === active.id
                  ? {
                      ...d,
                      body: d.body + insert,
                      updatedAt: new Date().toISOString(),
                    }
                  : d,
              )
            : [...documents, ...s.documents],
      }));
      await store.flush();
      setModal("");
      if (documents[0]) openDoc(documents[0].id);
      notify(t("imported"));
    });
  const checkForUpdates = () =>
    run(async () => {
      setUpdateMessage(t("checking"));
      try {
        const found = await checkUpdate();
        setUpdate(found);
        setUpdateMessage(
          found ? `${t("updateAvailable")} · v${found.version}` : t("upToDate"),
        );
        if (found) setModal("update");
      } catch (e) {
        setUpdateMessage(t(native ? "updateFailed" : "desktopOnly"));
        throw e;
      }
    });
  const saveLibrary = () => {
    const name = libraryName.trim();
    if (!name) return;
    change((s) => ({
      ...s,
      libraries: editingLibrary
        ? s.libraries.map((l) =>
            l.id === editingLibrary ? { ...l, name, color: libraryColor } : l,
          )
        : [
            ...s.libraries,
            { id: crypto.randomUUID(), name, color: libraryColor },
          ],
    }));
    setLibraryName("");
    setEditingLibrary(null);
    notify(t("saved"));
  };
  const removed = (doc: Document) => {
    patch(doc.id, {
      deletedAt: doc.deletedAt ? null : new Date().toISOString(),
    });
    setSelected(null);
    notify(t(doc.deletedAt ? "restored" : "removed"));
  };
  if (store.status === "error" && !store.ready)
    return (
      <div className="startup">
        <AlertCircle size={32} />
        <p>{t("saveError")}</p>
        <small>{store.error}</small>
        <Button onClick={() => void store.load()}>{t("retry")}</Button>
      </div>
    );
  if (store.status === "loading")
    return (
      <div className="startup">
        <img src="/brand/orvia-symbol.svg" alt="Orvia" />
        <p>{t("loading")}</p>
      </div>
    );
  return (
    <div className="app-shell">
      <header
        className="titlebar"
        data-tauri-drag-region
        onDoubleClick={() => void windowAction("toggleMaximize")}
      >
        <div className="title-brand" data-tauri-drag-region>
          <span className="logo small">
            <img src="/brand/orvia-symbol.svg" alt="" />
          </span>
          <b>Orvia</b>
          <span className="title-divider" />
          {t("personal")}
        </div>
        <span className="title-caption" data-tauri-drag-region>
          {t("tagline")}
        </span>
        <div className="window-actions">
          <button
            aria-label={t("minimize")}
            onClick={() => void windowAction("minimize")}
            disabled={!native}
          >
            <Minus size={13} />
          </button>
          <button
            aria-label={t("maximize")}
            onClick={() => void windowAction("toggleMaximize")}
            disabled={!native}
          >
            <Square size={11} />
          </button>
          <button
            aria-label={t("close")}
            onClick={() => void windowAction("close")}
            disabled={!native}
          >
            <X size={15} />
          </button>
        </div>
      </header>
      <div className={`workspace ${data.settings.sidebar ? "" : "collapsed"}`}>
        {data.settings.sidebar && (
          <aside className="sidebar">
            <button
              className="workspace-picker"
              onClick={() => setModal("backup")}
            >
              <span className="workspace-avatar">
                <img src="/brand/orvia-symbol.svg" alt="" />
                <span />
              </span>
              <span>
                <b>{t("workspace")}</b>
                <small>{t("localWorkspace")}</small>
              </span>
              <ChevronDown size={14} />
            </button>
            <button
              className="search-launch"
              onClick={() => setModal("search")}
            >
              <Search size={15} />
              <span>{t("search")}</span>
              <kbd>Ctrl K</kbd>
            </button>
            <div className="nav-group">
              {(
                [
                  { key: "all", icon: Files },
                  { key: "recent", icon: Clock3 },
                  { key: "starred", icon: Star },
                ] as const
              ).map((n) => (
                <button
                  key={n.key}
                  className={`nav-row ${page === n.key && !active ? "active" : ""}`}
                  onClick={() => navigate(n.key)}
                >
                  <n.icon size={17} />
                  <span>{t(n.key)}</span>
                  <small>
                    {n.key === "all"
                      ? docsAlive.length
                      : n.key === "starred"
                        ? docsAlive.filter((d) => d.starred).length
                        : ""}
                  </small>
                </button>
              ))}
            </div>
            <div className="group-heading">
              <span>{t("libraries")}</span>
              <button
                aria-label={t("newLibrary")}
                onClick={() => {
                  setEditingLibrary(null);
                  setLibraryName("");
                  setModal("libraries");
                }}
              >
                <Plus size={14} />
              </button>
            </div>
            <div className="nav-group libraries">
              {data.libraries.map((l) => (
                <div className="library-row" key={l.id}>
                  <button
                    className={`nav-row ${page === l.id ? "active" : ""}`}
                    onClick={() => navigate(l.id)}
                  >
                    <span className={`folder-icon ${l.color}`}>
                      <Folder size={16} />
                    </span>
                    <span className="ellipsis">{l.name}</span>
                    <small>
                      {docsAlive.filter((d) => d.libraryId === l.id).length}
                    </small>
                  </button>
                  <button
                    className="library-menu"
                    aria-label={t("renameLibrary") + " " + l.name}
                    onClick={() => {
                      setEditingLibrary(l.id);
                      setLibraryName(l.name);
                      setLibraryColor(l.color);
                      setModal("libraries");
                    }}
                  >
                    <MoreHorizontal size={14} />
                  </button>
                </div>
              ))}
            </div>
            <div className="sidebar-bottom">
              <button
                className={`nav-row ${page === "trash" ? "active" : ""}`}
                onClick={() => navigate("trash")}
              >
                <Trash2 size={16} />
                <span>{t("trash")}</span>
                <small>
                  {data.documents.filter((d) => d.deletedAt).length}
                </small>
              </button>
              <button className="nav-row" onClick={() => setModal("settings")}>
                <Settings size={16} />
                <span>{t("settings")}</span>
                <span className="shortcut">Ctrl ,</span>
              </button>
              <div className="sidebar-foot">
                <span>WINDOWS · v{APP_VERSION}</span>
                <button
                  aria-label={t("about")}
                  onClick={() => setModal("about")}
                >
                  <CircleHelp size={13} />
                </button>
              </div>
            </div>
          </aside>
        )}
        <main className="main">
          <div className="topbar">
            <div className="breadcrumbs">
              {iconButton(PanelLeft, t("sidebar"), () =>
                change((s) => ({
                  ...s,
                  settings: { ...s.settings, sidebar: !s.settings.sidebar },
                })),
              )}
              <span>{t("workspace")}</span>
              <ChevronRight size={13} />
              <b>{active ? library?.name : pageName}</b>
              {active && (
                <>
                  <ChevronRight size={13} />
                  <span className="crumb-doc">{active.title}</span>
                </>
              )}
            </div>
            <div className="topbar-right">
              <span className="local-status">
                <span className="green-dot" />
                {t("offline")}
              </span>
              {iconButton(Bell, t("backup"), () => setModal("backup"))}
            </div>
          </div>
          {store.status === "error" && (
            <div className="save-error" role="alert">
              <AlertCircle size={16} />
              <span>
                {store.error.includes("CONFLICT")
                  ? t("conflict")
                  : t("saveError")}
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void store.flush().catch(error)}
              >
                {t("retry")}
              </Button>
              <Button size="sm" variant="outline" onClick={exportBackup}>
                {t("backupExport")}
              </Button>
            </div>
          )}
          {active ? (
            <>
              <div className="editor-toolbar">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelected(null)}
                >
                  <ArrowLeft size={15} />
                  {t("back")}
                </Button>
                <span className="muted editor-save">
                  <CheckCircle2 size={13} />
                  {saveLabel}
                </span>
                <div className="flex-spacer" />
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
                {iconButton(Download, t("export"), () =>
                  markdownExport(active.id),
                )}
                {iconButton(
                  Trash2,
                  t(active.deletedAt ? "restore" : "remove"),
                  () => removed(active),
                )}
                {active.deletedAt &&
                  iconButton(X, t("purge"), () => setModal("purge"))}
              </div>
              <div className="editor-layout">
                <article className="editor-paper" ref={paper}>
                  <div className="eyebrow">
                    <span className={`dot ${library?.color}`} />
                    {library?.name}
                    <span>/</span>
                    {t("documents")}
                  </div>
                  <input
                    className="document-title"
                    aria-label={t("title")}
                    maxLength={300}
                    readOnly={preview || !!active.deletedAt}
                    value={active.title}
                    onChange={(e) =>
                      patch(active.id, { title: e.target.value })
                    }
                  />
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
                          img: ({ src, alt }) => (
                            <LocalImage src={src} alt={alt} />
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
                      key={active.id}
                      value={active.body}
                      locale={locale}
                      onChange={(body) => patch(active.id, { body })}
                      onImage={() => importFiles(true)}
                      busy={busy}
                      notify={notify}
                    />
                  )}
                </article>
                <DocumentOutline
                  body={active.body}
                  locale={locale}
                  paper={paper}
                />
              </div>
            </>
          ) : (
            <div className="page-content">
              <div className="page-intro">
                <div>
                  <div className="eyebrow">YOUR PERSONAL KNOWLEDGE SPACE</div>
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
              {page === "all" && !query && (
                <>
                  <div className="summary-grid">
                    <div className="summary-card">
                      <span className="stat-icon neutral">
                        <Files size={19} />
                      </span>
                      <div>
                        <small>{t("all")}</small>
                        <strong>
                          {docsAlive.length.toString().padStart(2, "0")}
                          <span>{t("records")}</span>
                        </strong>
                      </div>
                      <span className="stat-foot">{t("accumulate")}</span>
                    </div>
                    <div className="summary-card">
                      <span className="stat-icon amber">
                        <BookOpen size={19} />
                      </span>
                      <div>
                        <small>{t("libraryCount")}</small>
                        <strong>
                          {data.libraries.length.toString().padStart(2, "0")}
                          <span>{t("spaces")}</span>
                        </strong>
                      </div>
                      <span className="stat-foot">{t("passion")}</span>
                    </div>
                    <div className="summary-card">
                      <span className="stat-icon green">
                        <PencilLine size={19} />
                      </span>
                      <div>
                        <small>{t("week")}</small>
                        <strong>{thisWeek.toString().padStart(2, "0")}</strong>
                      </div>
                    </div>
                  </div>
                  {recents.length > 0 && (
                    <>
                      <div className="section-heading">
                        <h2>
                          <Clock3 size={16} />
                          {t("continue")}
                        </h2>
                        <span>{t("flow")}</span>
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
                                {
                                  data.libraries.find(
                                    (l) => l.id === d.libraryId,
                                  )?.name
                                }
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
              <div className="document-section">
                <div className="document-heading">
                  <h2>
                    {t(
                      query
                        ? "results"
                        : page === "trash"
                          ? "deleted"
                          : "documents",
                    )}
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
                    const lib = data.libraries.find(
                      (l) => l.id === d.libraryId,
                    )!;
                    return (
                      <div className="document-card" key={d.id}>
                        <button
                          className="card-main"
                          onClick={() => openDoc(d.id)}
                        >
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
                              onClick={() =>
                                patch(d.id, { starred: !d.starred })
                              }
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
          )}
          <footer className="statusbar">
            <span>
              <span
                className={store.status === "error" ? "error-dot" : "green-dot"}
              />
              {native ? saveLabel : t("browserPreview")}
            </span>
            <span>
              {languageRegistry.find((l) => l.code === locale)?.name}
              <span className="status-sep" />
              UTF-8
              <span className="status-sep" />
              <HardDrive size={12} />
              Windows
            </span>
          </footer>
        </main>
      </div>
      <Dialog
        open={!!modal}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setModal("");
            setUpdate(null);
          }
        }}
      >
        <DialogContent
          closeLabel={t("close")}
          className={modal === "settings" ? "settings-dialog" : "dialog"}
          onEscapeKeyDown={(e) => busy && e.preventDefault()}
          onPointerDownOutside={(e) => busy && e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>
              {t(
                (
                  {
                    new: "new",
                    search: "search",
                    import: "import",
                    settings: "settings",
                    backup: "backup",
                    libraries: editingLibrary ? "renameLibrary" : "newLibrary",
                    about: "about",
                    purge: "purge",
                    restore: "restoreBackup",
                    update: "updateAvailable",
                  } as Record<string, MessageKey>
                )[modal] ?? "about",
              )}
            </DialogTitle>
            <DialogDescription>
              {modal === "new" ? t("newHint") : "Orvia · v" + APP_VERSION}
            </DialogDescription>
          </DialogHeader>
          {modal === "new" && (
            <div className="modal-stack">
              <label>
                {t("title")}
                <Input
                  autoFocus
                  maxLength={300}
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && create()}
                  placeholder={t("titlePlaceholder")}
                />
              </label>
              <label>
                {t("belongs")}
                <select
                  className="full-select"
                  value={libraryId}
                  onChange={(e) => setLibraryId(e.target.value)}
                >
                  {data.libraries.map((l) => (
                    <option value={l.id} key={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="modal-actions">
                <Button variant="outline" onClick={() => setModal("")}>
                  {t("cancel")}
                </Button>
                <Button disabled={!newTitle.trim()} onClick={create}>
                  <Plus size={15} />
                  {t("create")}
                </Button>
              </div>
            </div>
          )}
          {modal === "search" && (
            <div className="modal-stack">
              <Input
                autoFocus
                aria-label={t("search")}
                placeholder={t("queryHint")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <div className="search-results">
                {data.documents
                  .filter(
                    (d) =>
                      !d.deletedAt &&
                      (d.title + d.body + d.tags.join(" "))
                        .toLocaleLowerCase()
                        .includes(query.toLocaleLowerCase()),
                  )
                  .map((d) => (
                    <button
                      key={d.id}
                      onClick={() => {
                        openDoc(d.id);
                        setModal("");
                        setQuery("");
                      }}
                    >
                      <span
                        className={`file-icon ${data.libraries.find((l) => l.id === d.libraryId)?.color}`}
                      >
                        <FileText size={18} />
                      </span>
                      <span>
                        <b>{d.title || t("write")}</b>
                        <small>
                          {
                            data.libraries.find((l) => l.id === d.libraryId)
                              ?.name
                          }
                        </small>
                      </span>
                      <ChevronRight size={14} />
                    </button>
                  ))}
              </div>
            </div>
          )}
          {modal === "import" && (
            <div className="modal-stack">
              <div className="dropzone">
                <span className="stat-icon blue">
                  <ArrowUpFromLine size={24} />
                </span>
                <h3>{t("importHeading")}</h3>
                <p>{t("supported")}</p>
                <select
                  aria-label={t("belongs")}
                  className="full-select"
                  value={libraryId}
                  onChange={(e) => setLibraryId(e.target.value)}
                  disabled={busy}
                >
                  {data.libraries.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
                <Button disabled={busy} onClick={() => importFiles()}>
                  {t(busy ? "working" : "choose")}
                </Button>
                {job && <small>{job}</small>}
                {busy && (
                  <Button
                    variant="outline"
                    onClick={() => cancelRef.current?.abort()}
                  >
                    {t("cancel")}
                  </Button>
                )}
              </div>
              <div className="info-box">
                <ShieldCheck size={17} />
                <p>{t("importPrivacy")}</p>
              </div>
              <small className="muted">{t("importLimits")}</small>
            </div>
          )}
          {modal === "libraries" && (
            <div className="modal-stack">
              <label>
                {t("libraryName")}
                <Input
                  autoFocus
                  maxLength={100}
                  value={libraryName}
                  onChange={(e) => setLibraryName(e.target.value)}
                />
              </label>
              <label>
                {t("libraryColor")}
                <div className="color-picker">
                  {colors.map((color) => (
                    <button
                      key={color}
                      className={color}
                      aria-label={color}
                      aria-pressed={libraryColor === color}
                      onClick={() => setLibraryColor(color)}
                    >
                      {libraryColor === color && <Check size={16} />}
                    </button>
                  ))}
                </div>
              </label>
              <div className="modal-actions">
                {editingLibrary && (
                  <Button
                    variant="destructive"
                    disabled={
                      data.libraries.length <= 1 ||
                      data.documents.some((d) => d.libraryId === editingLibrary)
                    }
                    title={t("deleteLibraryHint")}
                    onClick={() => {
                      change((s) => ({
                        ...s,
                        libraries: s.libraries.filter(
                          (l) => l.id !== editingLibrary,
                        ),
                      }));
                      navigate("all");
                      setModal("");
                    }}
                  >
                    {t("deleteLibrary")}
                  </Button>
                )}
                <Button disabled={!libraryName.trim()} onClick={saveLibrary}>
                  {t("save")}
                </Button>
              </div>
              {editingLibrary && (
                <p className="muted">{t("deleteLibraryHint")}</p>
              )}
            </div>
          )}
          {modal === "settings" && (
            <Tabs defaultValue="general">
              <TabsList className="settings-tabs">
                <TabsTrigger value="general">{t("general")}</TabsTrigger>
                <TabsTrigger value="storage">{t("storage")}</TabsTrigger>
                <TabsTrigger value="version">{t("version")}</TabsTrigger>
              </TabsList>
              <TabsContent value="general">
                <div className="settings-row">
                  <div>
                    <b>{t("language")}</b>
                    <p>{t("languageHint")}</p>
                  </div>
                  <select
                    aria-label={t("language")}
                    value={locale}
                    onChange={(e) =>
                      change((s) => ({
                        ...s,
                        settings: {
                          ...s.settings,
                          locale: e.target.value as Locale,
                        },
                      }))
                    }
                  >
                    {languageRegistry.map((l) => (
                      <option key={l.code} value={l.code}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="settings-row">
                  <b>{t("appearance")}</b>
                  <Badge variant="secondary">{t("light")}</Badge>
                </div>
                <div className="settings-row">
                  <b>{t("showSidebar")}</b>
                  <Switch
                    aria-label={t("showSidebar")}
                    checked={data.settings.sidebar}
                    onCheckedChange={(sidebar) =>
                      change((s) => ({
                        ...s,
                        settings: { ...s.settings, sidebar },
                      }))
                    }
                  />
                </div>
              </TabsContent>
              <TabsContent value="storage">
                <div className="settings-row">
                  <div>
                    <b>{t("dataPath")}</b>
                    <p className="data-path">{store.path}</p>
                  </div>
                  <Badge variant="secondary">{sizeLabel}</Badge>
                </div>
                <div className="settings-row">
                  <div>
                    <b>{t("backupExport")}</b>
                    <p>{t("backupHint")}</p>
                  </div>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={exportBackup}
                  >
                    <ArrowDownToLine size={14} />
                    {t("backupExport")}
                  </Button>
                </div>
                <div className="settings-row">
                  <div>
                    <b>{t("restoreBackup")}</b>
                    <p>{t("restoreHint")}</p>
                  </div>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={restoreSelect}
                  >
                    {t("restoreBackup")}
                  </Button>
                </div>
                <div className="settings-row">
                  <b>{t("export")}</b>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => markdownExport()}
                  >
                    {t("export")}
                  </Button>
                </div>
              </TabsContent>
              <TabsContent value="version">
                <div className="settings-row">
                  <div>
                    <b>Orvia v{APP_VERSION}</b>
                    <p>{RELEASE_NOTE}</p>
                  </div>
                  <img
                    className="about-mark"
                    src="/brand/orvia-symbol.svg"
                    alt="Orvia"
                  />
                </div>
                <div className="settings-row">
                  <div>
                    <b>{t("checkUpdates")}</b>
                    <p>{t("networkHint")}</p>
                  </div>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={checkForUpdates}
                  >
                    <RefreshCw size={14} />
                    {t("checkUpdates")}
                  </Button>
                </div>
                {updateMessage && (
                  <p className="muted" role="status">
                    {updateMessage}
                  </p>
                )}
              </TabsContent>
            </Tabs>
          )}
          {modal === "backup" && (
            <div className="modal-stack">
              <div className="info-box amber">
                <AlertCircle size={18} />
                <p>{t("backupWarning")}</p>
              </div>
              <p className="muted">{t("backupHint")}</p>
              <Button disabled={busy} onClick={exportBackup}>
                <ArrowDownToLine size={15} />
                {t("backupExport")}
              </Button>
              <Button variant="outline" disabled={busy} onClick={restoreSelect}>
                {t("restoreBackup")}
              </Button>
            </div>
          )}
          {modal === "restore" && (
            <div className="modal-stack">
              <p>{t("restoreConfirm")}</p>
              <Badge variant="secondary">
                {restoreCount} {t("documents")}
              </Badge>
              <div className="modal-actions">
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setRestoreBytes(null);
                    setModal("");
                  }}
                >
                  {t("cancel")}
                </Button>
                <Button disabled={busy} onClick={restore}>
                  {t(busy ? "working" : "confirm")}
                </Button>
              </div>
            </div>
          )}
          {modal === "purge" && active && (
            <div className="modal-stack">
              <p>{t("purgeHint")}</p>
              <div className="modal-actions">
                <Button variant="outline" onClick={() => setModal("")}>
                  {t("cancel")}
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => {
                    change((s) => ({
                      ...s,
                      documents: s.documents.filter((d) => d.id !== active.id),
                    }));
                    setSelected(null);
                    setModal("");
                  }}
                >
                  {t("purge")}
                </Button>
              </div>
            </div>
          )}
          {modal === "update" && update && (
            <div className="modal-stack">
              <h3>
                v{APP_VERSION} → v{update.version}
              </h3>
              <p>{update.body}</p>
              <div className="info-box">
                <ShieldCheck size={17} />
                <p>{t("updateHint")}</p>
              </div>
              {busy && <p>{progress}%</p>}
              <div className="modal-actions">
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setModal("settings");
                    setUpdate(null);
                  }}
                >
                  {t("cancel")}
                </Button>
                <Button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      try {
                        await installUpdate(update, setProgress);
                      } catch (e) {
                        setUpdateMessage(t("updateFailed"));
                        throw e;
                      }
                    })
                  }
                >
                  {t("updateInstall")}
                </Button>
              </div>
            </div>
          )}
          {modal === "about" && (
            <div className="modal-stack">
              <span className="logo">
                <img src="/brand/orvia-symbol.svg" alt="Orvia" />
              </span>
              <p>Orvia · {t("tagline")}</p>
              <Badge variant="secondary">v{APP_VERSION}</Badge>
              <p>{RELEASE_NOTE}</p>
              <p className="muted">{t("footer")}</p>
              <p className="muted">
                Copyright © 2026 zeze49024 · LicenseRef-Orvia-Noncommercial-1.0
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={17} />
          <span>{toast}</span>
          <button aria-label={t("close")} onClick={() => setToast("")}>
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
const root = createRoot(document.getElementById("root")!);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
