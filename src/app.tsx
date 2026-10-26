import { VaultPanel } from "./components/vault-panel";
import { AdvancedSearch } from "./components/advanced-search";
import { vaultSession } from "./core/vault";
import { templates, words, matchesShortcut } from "./core/productivity";
import { useWorkspaceMaintenance } from "./hooks/use-workspace-maintenance";
import { applyMotion } from "./core/motion";
import { useViewMotion } from "./hooks/use-view-motion";
import { RecoveryNotice } from "./components/recovery-notice";
import { exportPdf } from "./core/pdf-export";
import { useConfirmation } from "./hooks/use-confirmation";
import { useUpdateDiscovery } from "./hooks/use-update-discovery";
import { useJobRunner } from "./hooks/use-job-runner";
import { ThemePicker } from "@/components/theme-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  createFullBackup,
  prepareRestore,
  inspectBackup,
  mergeAssets,
} from "@/core/backup";
import { exportDocuments, zipDocuments, shareDocuments } from "@/core/batch";
import { chooseFiles, saveFile, saveFiles } from "@/core/files";
import { chooseMarkdownFolder } from "@/core/markdown-folder";
import { convertFile } from "@/core/import";
import { exportMarkdownDocument } from "@/core/markdown-export";
import {
  APP_VERSION,
  RELEASE_NOTE,
  colors,
  newDocument,
  type Asset,
  type Document,
} from "@/core/model";
import { native, store } from "@/core/storage";
import { applyTheme, resolveTheme } from "@/core/themes";
import { installUpdate } from "@/core/updates";
import { languageRegistry, translator, type MessageKey } from "@/i18n";

import {
  AlertCircle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  FileText,
  Files,
  Folder,
  HardDrive,
  Minus,
  MoreHorizontal,
  PanelLeft,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Square,
  Star,
  Trash2,
  X,
} from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from "react";

import { EditorWorkspace } from "./components/editor-workspace";
import { LibraryHome } from "./components/library-home";
import { SettingsPanel } from "./components/settings-panel";
export function App() {
  const [, redraw] = useReducer((n) => n + 1, 0),
    [exportDocumentId, setExportDocumentId] = useState(""),
    [page, setPage] = useState("all"),
    [query, setQuery] = useState(""),
    [selected, setSelected] = useState<string | null>(null),
    [settingsOpen, setSettingsOpen] = useState(false),
    [modal, setModal] = useState(""),
    [toast, setToast] = useState(""),
    [preview, setPreview] = useState(false),
    [sort, setSort] = useState("updated");
  const [newTitle, setNewTitle] = useState(""),
    [libraryId, setLibraryId] = useState(""),
    [libraryName, setLibraryName] = useState(""),
    [libraryColor, setLibraryColor] = useState<(typeof colors)[number]>("blue"),
    [editingLibrary, setEditingLibrary] = useState<string | null>(null),
    [restoreBytes, setRestoreBytes] = useState<Uint8Array | null>(null),
    [restoreCount, setRestoreCount] = useState(0),
    [installing, setInstalling] = useState(false),
    [progress, setProgress] = useState(0),
    [updateMessage, setUpdateMessage] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const [searchRequest, setSearchRequest] = useState<{
    id: string;
    query: string;
    serial: number;
  } | null>(null);
  const [templateId, setTemplateId] = useState("blank"),
    [restoreSettings, setRestoreSettings] = useState(false),
    [restoreSummary, setRestoreSummary] = useState("");
  const data = store.data,
    locale = data.settings.locale,
    currentTheme = resolveTheme(
      store.ready
        ? data.settings.theme
        : document.documentElement.dataset.theme,
    ),
    logoPath =
      currentTheme.appearance === "dark"
        ? "/brand/orvia-symbol-dark.svg"
        : "/brand/orvia-symbol.svg",
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
      (message.includes("TEXT_ENCODING_UNSUPPORTED")
        ? t("textEncoding")
        : /RELATIVE_IMAGE_NOT_FOUND|IMAGE_OUTSIDE_FOLDER/.test(message)
          ? t("relativeImageError")
          : message.includes("CONFLICT")
            ? t("conflict")
            : t("failed")) +
        " · " +
        message.replace(/^Error: /, "").slice(0, 140),
    );
  };
  const { busy, busyRef, job, setJob, cancelRef, run } = useJobRunner(error);
  const { confirm, confirmationDialog } = useConfirmation(locale);
  const { update, inspect, hold } = useUpdateDiscovery(
    data.settings.autoUpdate,
    store.ready,
    busyRef,
    data.settings.updateChannel,
  );
  useWorkspaceMaintenance(store.ready, store.vaultMode, busyRef, run, notify);
  useEffect(() => {
    setSearchRequest(null);
    setSelected(null);
    setQuery("");
    setModal("");
    setPreview(false);
    setSettingsOpen(false);
  }, [store.vaultMode]);
  useEffect(() => store.subscribe(redraw), []);
  useLayoutEffect(() => {
    if (store.ready) applyTheme(data.settings.theme);
  }, [data.settings.theme, store.ready]);
  useLayoutEffect(()=>{applyMotion(data.settings.motion);},[data.settings.motion]);
  useViewMotion(`${store.ready}:${store.vaultMode}:${settingsOpen}:${page}:${selected||''}`,settingsOpen?'.settings-page':'#main-content');
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
      if (!store.ready || document.querySelector(".update-progress")) return;
      if (
        e.isComposing ||
        e.keyCode === 229 ||
        document.querySelector('[role="alertdialog"]')
      )
        return;
      if (
        matchesShortcut(e, store.data.settings.shortcuts.lockVault) &&
        store.vaultMode === "private"
      ) {
        e.preventDefault();
        void run(() => store.lockVault());
        return;
      }
      if (
        matchesShortcut(e, store.data.settings.shortcuts.newNote) &&
        !document.querySelector('[role="dialog"]')
      ) {
        e.preventDefault();
        setLibraryId(store.data.libraries[0].id);
        setModal("new");
        return;
      }
      if (e.key === "Escape" && !document.querySelector('[role="dialog"]'))
        setSettingsOpen(false);
      if (matchesShortcut(e, store.data.settings.shortcuts.searchAll)) {
        e.preventDefault();
        setModal("search");
      }
      if (matchesShortcut(e, store.data.settings.shortcuts.settings)) {
        e.preventDefault();
        setModal("");
        setSettingsOpen(true);
      }
      if (matchesShortcut(e, store.data.settings.shortcuts.save)) {
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
    setSettingsOpen(false);
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
    setSettingsOpen(false);
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
    doc.body =
      [...templates(locale), ...data.settings.templates].find(
        (t) => t.id === templateId,
      )?.body ?? "";
    change((s) => ({ ...s, documents: [doc, ...s.documents] }));
    setSelected(doc.id);
    setNewTitle("");
    setPage("all");
    setModal("");
    notify(t("created"));
  };
  const batchExport = (ids: string[], format: "files" | "zip" | "share") =>
    void run(async () => {
      await store.flush();
      if (!(await allowPlaintext())) return;
      let saved = false;
      if (format === "share") {
        const file = await shareDocuments(store.data, ids);
        saved = await saveFile(file.name, file.bytes, ["html"]);
      } else {
        const files = await exportDocuments(store.data, ids);
        saved =
          format === "zip"
            ? await saveFile("Orvia-notes.zip", zipDocuments(files), ["zip"])
            : await saveFiles(files);
      }
      if (saved) notify(t("batchDone"));
    });
  const visible = selected
    ? []
    : data.documents
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
        .sort(
          (a, b) =>
            Number(b.pinned) - Number(a.pinned) ||
            (sort === "az"
              ? a.title.localeCompare(b.title, locale)
              : sort === "oldest"
                ? a.createdAt.localeCompare(b.createdAt)
                : page === "recent"
                  ? (b.openedAt ?? "").localeCompare(a.openedAt ?? "")
                  : b.updatedAt.localeCompare(a.updatedAt)),
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
      data.documents.reduce(
        (n, d) => n + d.body.length * 2 + d.title.length * 2,
        0,
      ) + data.assets.reduce((n, a) => n + a.size, 0),
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
      await store.flush();
      const encrypted = vaultSession.active;
      const bytes = encrypted
        ? await vaultSession.backup(store.recovery)
        : await createFullBackup(structuredClone(store.data), {
            history: true,
            trash: true,
            settings: true,
          });
      if (
        await saveFile(
          `Orvia-${new Date().toISOString().slice(0, 10)}.${encrypted ? "orvia-vault" : "orvia"}`,
          bytes,
          [encrypted ? "orvia-vault" : "orvia"],
        )
      )
        notify(t("exported"));
    });
  const allowPlaintext = async () =>
    !vaultSession.active ||
    (await confirm({
      title: words(
        locale,
        "导出明文文件？",
        "匯出明文檔案？",
        "Export plaintext?",
      ),
      description: words(
        locale,
        "导出的文件不再受加密空间保护。请妥善保存。",
        "匯出的檔案不再受加密空間保護。請妥善保存。",
        "Exported files are not protected by vault encryption. Store them safely.",
      ),
    }));
  const markdownExport = (id: string) =>
    run(async () => {
      if (!(await allowPlaintext())) return;
      const file = await exportMarkdownDocument(
        structuredClone(store.data),
        id,
      );
      if (await saveFile(file.name, file.bytes, ["md"])) notify(t("exported"));
    });
  const pdfExport = (id: string) =>
    run(async () => {
      if (!(await allowPlaintext())) return;
      if (await exportPdf(structuredClone(store.data), id))
        notify(t(native ? "exported" : "pdfPrintClosed"));
    });
  const restoreSelect = () =>
    run(async () => {
      const files = await chooseFiles(["orvia", "zip"], false);
      if (!files.length) return;
      const result = await inspectBackup(files[0].bytes);
      setRestoreSettings(false);
      setRestoreSummary(
        `${result.data.libraries.length} ${words(locale, "知识库", "知識庫", "libraries")} · ${result.data.assets.length} ${words(locale, "图片", "圖片", "images")} · ${Object.values(result.history).reduce((n, v) => n + v.length, 0)} ${words(locale, "历史版本", "歷史版本", "history")} · ${result.data.documents.filter((d) => d.deletedAt).length} ${words(locale, "回收站笔记", "回收站筆記", "trash notes")} · ${result.data.documents
          .slice(0, 5)
          .map((d) => d.title)
          .join(" / ")}`,
      );
      setRestoreBytes(files[0].bytes);
      setRestoreCount(result.data.documents.length);
      setModal("restore");
    });
  const restore = () =>
    run(async () => {
      if (!restoreBytes) return;
      const next = await prepareRestore(
        store.data,
        restoreBytes,
        restoreSettings,
      );
      await store.applyRestore(next.data, next.history);
      setRestoreBytes(null);
      setModal("");
      notify(t("restoredBackup"));
    });
  const importFiles = (
    imagesOnly = false,
    insertAtCaret?: (markdown: string) => void,
    folder = false,
    incoming?: File[],
  ) =>
    run(async () => {
      const controller = new AbortController();
      cancelRef.current = controller;
      if (
        incoming &&
        (incoming.length > 100 ||
          incoming.some((f) => f.size > 20 * 1024 * 1024) ||
          incoming.reduce((n, f) => n + f.size, 0) > 128 * 1024 * 1024)
      )
        throw new Error("FILE_TOO_LARGE");
      const files = incoming
        ? await Promise.all(
            incoming.map(async (file) => ({
              name: file.name,
              bytes: new Uint8Array(await file.arrayBuffer()),
            })),
          )
        : folder
          ? await chooseMarkdownFolder()
          : await chooseFiles(
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
            ? insertAtCaret
              ? s.documents
              : s.documents.map((d) =>
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
      if (insert && insertAtCaret) insertAtCaret(insert);
      await store.flush();
      setModal("");
      if (documents[0]) openDoc(documents[0].id);
      notify(t("imported"));
    });
  const checkForUpdates = () =>
    run(async () => {
      setUpdateMessage(t("checking"));
      try {
        const found = await inspect();
        setUpdateMessage(
          found ? `${t("updateAvailable")} · v${found.version}` : t("upToDate"),
        );
        if (found) setModal("update");
      } catch (e) {
        setUpdateMessage(t(native ? "updateFailed" : "desktopOnly"));
        throw e;
      }
    });
  const startUpdate = () => {
    if (!update || busyRef.current) return;
    const release = hold();
    setInstalling(true);
    setProgress(0);
    setModal("update");
    void run(async () => {
      try {
        await installUpdate(update, setProgress);
      } catch (e) {
        setUpdateMessage(t("updateFailed"));
        throw e;
      } finally {
        release();
        setInstalling(false);
      }
    });
  };
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
  const removed = async (doc: Document) => {
    if (
      !doc.deletedAt &&
      !(await confirm({
        title: t("confirmDelete"),
        description: t("deleteConfirmHint"),
        names: [doc.title],
        danger: true,
      }))
    )
      return;
    patch(doc.id, {
      deletedAt: doc.deletedAt ? null : new Date().toISOString(),
    });
    setSelected(null);
    notify(t(doc.deletedAt ? "restored" : "removed"));
  };
  if (store.vaultMode === "locked")
    return (
      <>
        {confirmationDialog}
        <header className="titlebar" data-tauri-drag-region>
          <b data-tauri-drag-region>Orvia</b>
          <div className="flex-spacer" />
          <Button
            variant="ghost"
            aria-label={t("minimize")}
            onClick={() => void windowAction("minimize")}
          >
            <Minus size={16} />
          </Button>
          <Button
            variant="ghost"
            aria-label={t("close")}
            onClick={() => void windowAction("close")}
          >
            <X size={16} />
          </Button>
        </header>
        <VaultPanel gate busy={busy} run={run} confirm={confirm} />
        {toast && (
          <p className="toast" role="alert">
            {toast}
          </p>
        )}
      </>
    );
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
        <img src={logoPath} alt="Orvia" />
        <p>{t("loading")}</p>
      </div>
    );
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        {words(locale, "跳到主要内容", "跳到主要內容", "Skip to main content")}
      </a>
      {confirmationDialog}
      <header
        className="titlebar"
        data-tauri-drag-region
        onDoubleClick={() => void windowAction("toggleMaximize")}
      >
        <div className="title-brand" data-tauri-drag-region>
          <span className="logo small">
            <img src={logoPath} alt="" />
          </span>
          <b>Orvia</b>
          <span className="title-divider" />
          {t("personal")}
        </div>
        <span className="title-caption" data-tauri-drag-region>
          {t("tagline")}
        </span>
        <div className="titlebar-right">
          {update && (
            <button
              className="update-badge"
              disabled={busy}
              title={"v" + update.version}
              onDoubleClick={(e) => e.stopPropagation()}
              onClick={startUpdate}
            >
              <ArrowDownToLine size={14} strokeWidth={2} aria-hidden="true" />
              {t("newVersionBadge")}
            </button>
          )}
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
        </div>
      </header>
      <div
        className={`workspace ${settingsOpen ? "settings-workspace" : data.settings.sidebar ? "" : "collapsed"}`}
      >
        {data.settings.sidebar && !settingsOpen && (
          <aside className="sidebar">
            <button
              className="workspace-picker"
              onClick={() => setModal("backup")}
            >
              <span className="workspace-avatar">
                <img src={logoPath} alt="" />
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
              <kbd>{data.settings.shortcuts.searchAll}</kbd>
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
              <button className="nav-row" onClick={() => setSettingsOpen(true)}>
                <Settings size={16} />
                <span>{t("settings")}</span>
                <span className="shortcut">
                  {data.settings.shortcuts.settings}
                </span>
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
          {!settingsOpen && (
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
                <ThemePicker
                  value={data.settings.theme}
                  locale={locale}
                  onChange={(theme) =>
                    change((s) => ({
                      ...s,
                      settings: { ...s.settings, theme },
                    }))
                  }
                />
              </div>
            </div>
          )}
          <RecoveryNotice
            locale={locale}
            notify={notify}
            confirm={confirm}
            onOpen={openDoc}
          />
          {store.recoveryState === "error" && (
            <div className="save-error" role="alert">
              {t("draftProtectionError")}
            </div>
          )}
          {store.error && store.ready && (
            <div className="save-error" role="alert">
              <AlertCircle size={16} />
              <span>
                {store.error.includes("CONFLICT")
                  ? t("conflict")
                  : t("saveError")}
                {" · "}
                {t(
                  store.recoveryState === "saved"
                    ? "draftProtected"
                    : "draftPending",
                )}
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
          {settingsOpen && (
            <SettingsPanel
              run={run}
              confirm={confirm}
              onBack={() => setSettingsOpen(false)}
              locale={locale}
              data={data}
              change={change}
              currentTheme={currentTheme}
              sizeLabel={sizeLabel}
              busy={busy}
              exportBackup={exportBackup}
              restoreSelect={restoreSelect}
              active={active}
              setExportDocumentId={setExportDocumentId}
              setModal={setModal}
              logoPath={logoPath}
              checkForUpdates={checkForUpdates}
              updateMessage={updateMessage}
            />
          )}

          {store.recoveryWarning && (
            <p role="alert">
              {words(
                locale,
                "损坏草稿已隔离保留。请在设置的存储分析中导出排查。",
                "損壞草稿已隔離保留。請在設定的儲存分析中匯出排查。",
                "A damaged recovery file was quarantined. Export it from storage settings for diagnosis.",
              )}
            </p>
          )}
          <div
            id="main-content"
            tabIndex={-1}
            className="workspace-content"
            hidden={settingsOpen}
          >
            {active ? (
              <EditorWorkspace
                key={active.id + store.vaultMode}
                run={run}
                suspended={settingsOpen}
                configureAi={()=>setSettingsOpen(true)}
                searchRequest={searchRequest}
                confirm={confirm}
                active={active}
                data={data}
                locale={locale}
                library={library}
                saveLabel={saveLabel}
                preview={preview}
                setPreview={setPreview}
                setSelected={setSelected}
                patch={patch}
                notify={notify}
                markdownExport={markdownExport}
                pdfExport={pdfExport}
                saveState={store.status}
                retrySave={() => void store.flush().catch(error)}
                removed={removed}
                setModal={setModal}
                importFiles={importFiles}
                busy={busy}
              />
            ) : (
              <LibraryHome
                confirm={confirm}
                batchExport={batchExport}
                key={page}
                data={data}
                page={page}
                pageName={pageName}
                query={query}
                setQuery={setQuery}
                busy={busy}
                setLibraryId={setLibraryId}
                setModal={setModal}
                newDialog={newDialog}
                docsAlive={docsAlive}
                thisWeek={thisWeek}
                recents={recents}
                openDoc={openDoc}
                sort={sort}
                setSort={setSort}
                change={change}
                visible={visible}
                patch={patch}
                removed={removed}
                locale={locale}
                setSelected={setSelected}
              />
            )}
          </div>
          <footer className="statusbar">
            <span>
              <span
                className={store.status === "error" ? "error-dot" : "green-dot"}
              />
              {saveLabel}
              {!native && <small> · {t("browserPreview")}</small>}
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
          }
        }}
      >
        <DialogContent
          closeLabel={t("close")}
          className={
            modal === "ai"
              ? "dialog ai-dialog"
              : modal === "settings"
                ? "settings-dialog"
                : "dialog"
          }
          onEscapeKeyDown={(e) => busy && e.preventDefault()}
          onPointerDownOutside={(e) => busy && e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>
              {t(
                (
                  {
                    ai: "aiTitle",
                    new: "new",
                    search: "search",
                    import: "import",
                    settings: "settings",
                    markdownExport: "export",
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
          {modal === "markdownExport" && (
            <div className="modal-stack">
              <label>
                {t("chooseDocument")}
                <select
                  className="full-select"
                  aria-label={t("chooseDocument")}
                  value={exportDocumentId}
                  onChange={(e) => setExportDocumentId(e.target.value)}
                >
                  <option value="" disabled>
                    {t("chooseDocument")}
                  </option>
                  {data.documents
                    .filter((d) => !d.deletedAt)
                    .map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.title || t("untitledHeading")}
                      </option>
                    ))}
                </select>
              </label>
              <div className="modal-actions">
                <Button
                  disabled={busy || !exportDocumentId}
                  onClick={() => markdownExport(exportDocumentId)}
                >
                  {t("export")}
                </Button>
              </div>
            </div>
          )}
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
                {words(locale, "笔记模板", "筆記範本", "Note template")}
                <select
                  className="full-select"
                  value={templateId}
                  onChange={(e) => setTemplateId(e.target.value)}
                >
                  {[...templates(locale), ...data.settings.templates].map(
                    (t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ),
                  )}
                </select>
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
            <AdvancedSearch
              query={query}
              setQuery={setQuery}
              open={(id, q) => {
                setSearchRequest({ id, query: q, serial: Date.now() });
                openDoc(id);
                setModal("");
                setQuery("");
              }}
            />
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
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => importFiles(false, undefined, true)}
                >
                  {t("chooseMarkdownFolder")}
                </Button>
                <small className="muted">{t("markdownFolderHint")}</small>
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
                    onClick={async () => {
                      if (
                        !(await confirm({
                          title: t("confirmDelete"),
                          description: t("deleteLibraryConfirm"),
                          names: [
                            data.libraries.find((l) => l.id === editingLibrary)
                              ?.name ?? "",
                          ],
                          danger: true,
                        }))
                      )
                        return;
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
              <p>{restoreSummary}</p>
              <label>
                <input
                  type="checkbox"
                  checked={restoreSettings}
                  onChange={(e) => setRestoreSettings(e.target.checked)}
                />
                {words(
                  locale,
                  "同时恢复应用设置（默认保留当前设置）",
                  "同時還原應用設定（預設保留目前設定）",
                  "Restore application settings (current settings kept by default)",
                )}
              </label>
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
              <strong>{active.title}</strong>
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

              {installing ? (
                <div className="update-progress" role="status">
                  <p>{t("updating")}</p>
                  <progress
                    aria-label={t("updating")}
                    max={100}
                    value={progress}
                  />
                  <p>
                    {progress}% · {t("updateProgressHint")}
                  </p>
                </div>
              ) : (
                <div className="modal-actions">
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      setModal("");
                      setSettingsOpen(true);
                    }}
                  >
                    {t("cancel")}
                  </Button>
                  <Button disabled={busy} onClick={startUpdate}>
                    {t("updateInstall")}
                  </Button>
                </div>
              )}
            </div>
          )}
          {modal === "about" && (
            <div className="modal-stack">
              <span className="logo">
                <img src={logoPath} alt="Orvia" />
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
