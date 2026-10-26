import { useEffect, useRef, useState, type RefObject } from "react";
import type { Update } from "@tauri-apps/plugin-updater";
import { checkUpdate, supportsUpdates } from "@/core/updates";
import { UpdateDiscovery, scheduleUpdateChecks } from "@/core/update-discovery";
export function useUpdateDiscovery(
  enabled: boolean,
  ready: boolean,
  busy: RefObject<boolean>,
  channel: "stable" | "preview" = "stable",
) {
  const [update, setUpdate] = useState<Update | null>(null);
  const monitor = useRef<UpdateDiscovery<Update> | null>(null);
  useEffect(() => {
    setUpdate(null);
    const instance = new UpdateDiscovery(() => checkUpdate(channel), setUpdate);
    monitor.current = instance;
    return () => {
      monitor.current = null;
      instance.dispose();
    };
  }, [channel]);
  useEffect(() => {
    if (!supportsUpdates || !enabled || !ready) return;
    return scheduleUpdateChecks(
      () => monitor.current!.check(),
      () => !busy.current,
    );
  }, [enabled, ready, busy, channel]);
  return {
    update,
    hold: () => monitor.current?.hold() ?? (() => {}),
    inspect: () => monitor.current?.check() ?? Promise.resolve(null),
  };
}
