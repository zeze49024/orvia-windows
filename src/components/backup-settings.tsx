import { SettingsGroup } from "./settings-group";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { store, native } from "@/core/storage";
import { words } from "@/core/productivity";
import { createFullBackup, inspectBackup } from "@/core/backup";
import { vaultSession } from "@/core/vault";
import { Button } from "./ui/button";
import { Switch } from "./ui/switch";
export async function automaticBackup() {
  await store.flush();
  await store.flushRecovery();
  if (store.recoverable.length || store.recoveryState === "error")
    throw new Error("BACKUP_PENDING_RECOVERY");
  const privateMode = vaultSession.active;
  const bytes = privateMode
    ? await vaultSession.backup(store.recovery)
    : await createFullBackup(store.data, {
        history: store.data.settings.autoBackup.history,
        trash: store.data.settings.autoBackup.trash,
        settings: true,
      });
  if (!privateMode) await inspectBackup(bytes);
  return invoke<string>("write_auto_backup", {
    bytes: Array.from(bytes),
    private: privateMode,
    keep: store.data.settings.autoBackup.keep,
  });
}
export function BackupSettings({
  busy,
  run,
}: {
  busy: boolean;
  run: (a: () => Promise<void>) => Promise<void>;
}) {
  const [path, setPath] = useState(""),
    [status, setStatus] = useState("");
  const s = store.data.settings.autoBackup,
    w = (a: string, b: string, c: string) =>
      words(store.data.settings.locale, a, b, c);
  useEffect(() => {
    if (native)
      void invoke<string>("backup_directory")
        .then(setPath)
        .catch(() => {});
  }, []);
  const patch = (v: Partial<typeof s>) =>
    store.change((d) => ({
      ...d,
      settings: {
        ...d.settings,
        autoBackup: { ...d.settings.autoBackup, ...v },
      },
    }));
  return (
    <SettingsGroup title={w("自动备份", "自動備份", "Automatic backups")}>
      <p>
        {w(
          "仅在应用打开且空间已解锁时执行；备份在独立授权目录保存，按空间分别保留。",
          "僅在應用開啟且空間已解鎖時執行；備份在獨立授權目錄儲存，按空間分別保留。",
          "Runs while the app is open and the workspace is unlocked. Backups use an authorized folder with separate retention per workspace.",
        )}
      </p>
      <div className="settings-inline-action">
        <Button
          disabled={busy || !native}
          variant="outline"
          onClick={() =>
            void run(async () => {
              const p = await invoke<string | null>("pick_backup_directory");
              if (p) setPath(p);
            })
          }
        >
          {w("选择备份目录", "選擇備份目錄", "Choose backup folder")}
        </Button>
        <p className="data-path">
          {path || w("尚未选择目录", "尚未選擇目錄", "No folder selected")}
        </p>
      </div>
      <label className="settings-row">
        {w("启用自动备份", "啟用自動備份", "Enable automatic backups")}{" "}
        <Switch
          aria-label="Automatic backups"
          checked={s.enabled}
          disabled={!path || !native || busy}
          onCheckedChange={(enabled) => patch({ enabled })}
        />
      </label>
      <div className="settings-field-grid">
        <label>
          {w("备份间隔", "備份間隔", "Interval")}{" "}
          <select
            value={s.intervalMinutes}
            onChange={(e) =>
              patch({
                intervalMinutes: Number(e.target.value) as 15 | 60 | 1440,
              })
            }
          >
            {[15, 60, 1440].map((n) => (
              <option key={n} value={n}>
                {n} min
              </option>
            ))}
          </select>
        </label>
        <label>
          {w("保留份数（3–50）", "保留份數（3–50）", "Retain copies (3–50)")}{" "}
          <input
            type="number"
            min={3}
            max={50}
            value={s.keep}
            onChange={(e) => {
              const keep = Number(e.target.value);
              if (keep >= 3 && keep <= 50) patch({ keep });
            }}
          />
        </label>
      </div>
      {!vaultSession.active && (
        <div className="settings-checks">
          <label>
            <input
              type="checkbox"
              checked={s.history}
              onChange={(e) => patch({ history: e.target.checked })}
            />
            {w("包含历史版本", "包含歷史版本", "Include version history")}
          </label>
          <label>
            <input
              type="checkbox"
              checked={s.trash}
              onChange={(e) => patch({ trash: e.target.checked })}
            />
            {w("包含回收站", "包含回收站", "Include trash")}
          </label>
        </div>
      )}
      <Button
        disabled={busy || !path || !native}
        onClick={() =>
          void run(async () => {
            const name = await automaticBackup();
            setStatus(name);
          })
        }
      >
        {w("立即备份到该目录", "立即備份到該目錄", "Back up now")}
      </Button>
      <p role="status">{status}</p>
    </SettingsGroup>
  );
}
