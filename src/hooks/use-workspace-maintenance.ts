import { useEffect } from "react";
import { store, native } from "@/core/storage";
import { words } from "@/core/productivity";
import { automaticBackup } from "@/components/backup-settings";
export function useWorkspaceMaintenance(
  ready: boolean,
  mode: string,
  busy: React.RefObject<boolean>,
  run: (a: () => Promise<void>) => Promise<void>,
  report: (s: string) => void,
) {
  useEffect(() => {
    if (!ready) return;
    const backupKey = "orvia-last-auto-backup-" + mode;
    let savedBackup = 0;
    try {
      const value = Number(localStorage.getItem(backupKey));
      if (Number.isFinite(value) && value > 0 && value <= Date.now())
        savedBackup = value;
    } catch {}
    let lastActivity = Date.now(),
      lastBackup = savedBackup,
      nextAttempt = Date.now() + 30000;
    const touch = () => {
      lastActivity = Date.now();
    };
    for (const name of ["keydown", "pointerdown", "pointermove", "wheel"])
      window.addEventListener(name, touch, { passive: true });
    const timer = setInterval(() => {
      if (busy.current) return;
      if (
        mode === "private" &&
        Date.now() - lastActivity >=
          store.data.settings.vaultAutoLockMinutes * 60000
      ) {
        void run(() => store.lockVault());
        return;
      }
      const options = store.data.settings.autoBackup;
      if (
        native &&
        options.enabled &&
        Date.now() >= nextAttempt &&
        Date.now() - lastBackup >= options.intervalMinutes * 60000
      ) {
        nextAttempt = Date.now() + 300000;
        void run(async () => {
          await automaticBackup();
          lastBackup = Date.now();
          try {
            localStorage.setItem(backupKey, String(lastBackup));
          } catch {}
          report(
            words(
              store.data.settings.locale,
              "自动备份已完成",
              "自動備份已完成",
              "Automatic backup complete",
            ),
          );
        });
      }
    }, 10000);
    return () => {
      clearInterval(timer);
      for (const name of ["keydown", "pointerdown", "pointermove", "wheel"])
        window.removeEventListener(name, touch);
    };
  }, [ready, mode, busy]);
}
