import { check, type Update } from "@tauri-apps/plugin-updater";
import { native, store } from "./storage";
export const supportsUpdates = native;
export async function checkUpdate(
  channel: "stable" | "preview" = "stable",
): Promise<Update | null> {
  if (!native) throw new Error("DESKTOP_ONLY");
  return check({ timeout: 20000, target: channel });
}
export async function installUpdate(
  update: Update,
  onProgress: (percent: number) => void,
) {
  await store.flush();
  let total = 0,
    received = 0;
  await update.download((event) => {
    if (event.event === "Started") total = event.data.contentLength ?? 0;
    else if (event.event === "Progress") {
      received += event.data.chunkLength;
      onProgress(
        total ? Math.min(99, Math.round((received / total) * 100)) : 0,
      );
    } else onProgress(100);
  });
  await store.flush();
  await update.install({ restartAfterInstall: true });
}
