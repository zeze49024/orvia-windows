import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
}: {
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
}) {
  const t = translator(locale);
  return (
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
          <Badge variant="secondary">{currentTheme.names[locale]}</Badge>
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
      </TabsContent>
      <TabsContent value="version">
        <div className="settings-row">
          <div>
            <b>Orvia v{APP_VERSION}</b>
            <p>{RELEASE_NOTE}</p>
          </div>
          <img className="about-mark" src={logoPath} alt="Orvia" />
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
      </TabsContent>
    </Tabs>
  );
}
