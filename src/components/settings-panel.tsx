import { AiSettings } from "./ai-settings";
import { useViewMotion } from "@/hooks/use-view-motion";
import type { MotionPreference } from "@/core/motion";
import { StorageManagement } from "./storage-management";
import { VaultPanel } from "./vault-panel";
import { BackupSettings } from "./backup-settings";
import { ProductivitySettings } from "./productivity-settings";
import { words } from "@/core/productivity";
import type { Confirm } from "@/hooks/use-confirmation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useState } from "react";
import { ThemePicker } from "./theme-picker";
import {
  ArrowLeft,
  Search,
  Settings,
  Shirt,
  Files,
  HardDrive,
  Info,
} from "lucide-react";
import {
  APP_VERSION,
  RELEASE_NOTE,
  type Document,
  type Locale,
} from "@/core/model";
import { store } from "@/core/storage";
import { resolveTheme } from "@/core/themes";
import { languageRegistry, translator } from "@/i18n";
import { ArrowDownToLine, RefreshCw } from "lucide-react";

import type { Workspace } from "@/core/model";
export function SettingsPanel({
  locale,
  run,
  confirm,
  data,
  change,
  currentTheme,
  sizeLabel,
  busy,
  exportBackup,
  restoreSelect,
  active,
  setExportDocumentId,
  setModal,
  logoPath,
  checkForUpdates,
  updateMessage,
  onBack,
}: {
  run: (a: () => Promise<void>) => Promise<void>;
  confirm: Confirm;
  locale: Locale;
  data: Workspace;
  change: (fn: (s: Workspace) => Workspace) => void;
  currentTheme: ReturnType<typeof resolveTheme>;
  sizeLabel: string;
  busy: boolean;
  exportBackup: () => void;
  restoreSelect: () => void;
  active: Document | undefined;
  setExportDocumentId: (s: string) => void;
  setModal: (s: string) => void;
  logoPath: string;
  checkForUpdates: () => void;
  updateMessage: string;
  onBack: () => void;
}) {
  const t = translator(locale);
  const [category, setCategory] = useState("general"),
    [query, setQuery] = useState("");
  useViewMotion(category, ".settings-content");
  const w = (a: string, b: string, c: string) => words(locale, a, b, c);
  const categories = [
    {
      id: "ai",
      label: t("aiSettings"),
      icon: Settings,
      content: <AiSettings locale={locale} confirm={confirm} />,
    },
    {
      id: "security",
      label: w(
        "安全与加密知识库",
        "安全與加密知識庫",
        "Security and encrypted vault",
      ),
      icon: HardDrive,
      content: <VaultPanel busy={busy} run={run} confirm={confirm} />,
    },
    {
      id: "productivity",
      label: w("模板与快捷键", "範本與快速鍵", "Templates and shortcuts"),
      icon: Files,
      content: <ProductivitySettings busy={busy} confirm={confirm} />,
    },
    {
      id: "general",
      label: t("general"),
      icon: Settings,
      content: (
        <>
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
        </>
      ),
    },
    {
      id: "appearance",
      label: t("appearance"),
      icon: Shirt,
      content: (
        <>
          <div className="settings-row">
            <div>
              <b>{t("theme")}</b>
              <p>{currentTheme.names[locale]}</p>
            </div>
            <ThemePicker
              locale={locale}
              value={data.settings.theme}
              onChange={(theme) =>
                change((s) => ({ ...s, settings: { ...s.settings, theme } }))
              }
            />
          </div>
          <div className="settings-row motion-settings-row">
            <div>
              <b>{t("motionTitle")}</b>
              <p>{t("motionHint")}</p>
            </div>
            <select
              aria-label={t("motionTitle")}
              value={data.settings.motion}
              onChange={(e) =>
                change((s) => ({
                  ...s,
                  settings: {
                    ...s.settings,
                    motion: e.target.value as MotionPreference,
                  },
                }))
              }
            >
              <option value="elegant">{t("motionElegant")}</option>
              <option value="moderate">{t("motionModerate")}</option>
              <option value="rapid">{t("motionRapid")}</option>
            </select>
          </div>
          <div className="motion-settings-preview">
            <span className="motion-preview-indicator" />
            {t("motionPreview")}
            <small>{t("motionReducedHint")}</small>
          </div>
        </>
      ),
    },
    {
      id: "importExport",
      label: t("importExport"),
      icon: Files,
      content: (
        <>
          <div className="settings-row">
            <div>
              <b>{t("import")}</b>
              <p>Markdown · Word · PDF</p>
            </div>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setModal("import")}
            >
              {t("import")}
            </Button>
          </div>{" "}
          <div className="settings-row">
            <b>{t("export")}</b>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setExportDocumentId(
                  active?.id ??
                    data.documents.find((d) => !d.deletedAt)?.id ??
                    "",
                );
                setModal("markdownExport");
              }}
            >
              {t("export")}
            </Button>
          </div>
        </>
      ),
    },
    {
      id: "storage",
      label: t("storageBackup"),
      icon: HardDrive,
      content: (
        <>
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
            <Button variant="outline" disabled={busy} onClick={exportBackup}>
              <ArrowDownToLine size={14} />
              {t("backupExport")}
            </Button>
          </div>
          <div className="settings-row">
            <div>
              <b>{t("restoreBackup")}</b>
              <p>{t("restoreHint")}</p>
            </div>
            <Button variant="outline" disabled={busy} onClick={restoreSelect}>
              {t("restoreBackup")}
            </Button>
          </div>
          <BackupSettings busy={busy} run={run} />
          <StorageManagement busy={busy} run={run} confirm={confirm} />
        </>
      ),
    },
    {
      id: "version",
      label: t("versionUpdates"),
      icon: RefreshCw,
      content: (
        <>
          <div className="settings-row">
            <div>
              <b>Orvia v{APP_VERSION}</b>
              <p>{RELEASE_NOTE}</p>
            </div>
            <img className="about-mark" src={logoPath} alt="Orvia" />
          </div>
          <div className="settings-row">
            <div>
              <b>{t("autoUpdate")}</b>
              <p>{t("autoUpdateHint")}</p>
            </div>
            <Switch
              aria-label={t("autoUpdate")}
              checked={data.settings.autoUpdate}
              onCheckedChange={(autoUpdate) =>
                change((s) => ({
                  ...s,
                  settings: { ...s.settings, autoUpdate },
                }))
              }
            />
          </div>
          <div className="settings-row">
            <div>
              <b>{w("更新通道", "更新通道", "Update channel")}</b>
              <p>
                {w(
                  "稳定通道仅接收正式版；预览通道包含测试版。",
                  "穩定通道僅接收正式版；預覽通道包含測試版。",
                  "Stable receives official releases. Preview includes test releases.",
                )}
              </p>
            </div>
            <select
              aria-label={w("更新通道", "更新通道", "Update channel")}
              value={data.settings.updateChannel}
              onChange={(e) => {
                const updateChannel = e.target.value as "stable" | "preview";
                void (async () => {
                  if (
                    updateChannel === "stable" ||
                    (await confirm({
                      title: w(
                        "加入预览通道？",
                        "加入預覽通道？",
                        "Join preview channel?",
                      ),
                      description: w(
                        "测试版可能不稳定。建议先备份数据。",
                        "測試版可能不穩定。建議先備份資料。",
                        "Test releases may be unstable. Back up your data first.",
                      ),
                    }))
                  )
                    change((s) => ({
                      ...s,
                      settings: { ...s.settings, updateChannel },
                    }));
                })();
              }}
            >
              <option value="stable">
                {w("稳定通道", "穩定通道", "Stable")}
              </option>
              <option value="preview">
                {w("预览通道", "預覽通道", "Preview")}
              </option>
            </select>
          </div>
          <div className="settings-row">
            <div>
              <b>{t("checkUpdates")}</b>
              <p>{t("networkHint")}</p>
            </div>
            <Button variant="outline" disabled={busy} onClick={checkForUpdates}>
              <RefreshCw size={14} />
              {t("checkUpdates")}
            </Button>
          </div>
          {updateMessage && (
            <p className="muted" role="status">
              {updateMessage}
            </p>
          )}
        </>
      ),
    },
    {
      id: "about",
      label: t("about"),
      icon: Info,
      content: (
        <div className="settings-row">
          <div>
            <b>Orvia v{APP_VERSION}</b>
            <p>{t("localOnly")}</p>
            <p>{t("footer")}</p>
          </div>
          <img className="about-mark" src={logoPath} alt="Orvia" />
        </div>
      ),
    },
  ];
  const keyword = query.trim().toLocaleLowerCase();
  const textOf = (node: unknown): string => {
    if (typeof node === "string" || typeof node === "number")
      return String(node);
    if (Array.isArray(node)) return node.map(textOf).join(" ");
    if (node && typeof node === "object" && "props" in node)
      return textOf((node as { props: { children?: unknown } }).props.children);
    return "";
  };
  const shown = categories.filter((c) =>
    keyword
      ? (c.label + " " + textOf(c.content))
          .toLocaleLowerCase()
          .includes(keyword)
      : c.id === category,
  );
  return (
    <section className="settings-page" aria-label={t("settings")}>
      <aside className="settings-nav">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft size={17} />
          {t("backLibrary")}
        </Button>
        <h1>{t("settings")}</h1>
        <label className="settings-search">
          <Search size={16} />
          <input
            aria-label={t("settingsSearch")}
            placeholder={t("settingsSearch")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <nav aria-label={t("settings")}>
          {categories.map((c) => (
            <button
              key={c.id}
              aria-current={!keyword && c.id === category ? "page" : undefined}
              onClick={() => {
                setCategory(c.id);
                setQuery("");
              }}
            >
              <c.icon size={17} />
              {c.label}
            </button>
          ))}
        </nav>
      </aside>
      <div className="settings-content">
        {shown.map((c) => (
          <section key={c.id}>
            <h2>{c.label}</h2>
            <div className="settings-card">{c.content}</div>
          </section>
        ))}
        {!shown.length && <p>{t("noSettings")}</p>}
      </div>
    </section>
  );
}
