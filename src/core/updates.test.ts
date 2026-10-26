import { expect, it, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({ flush: vi.fn(), check: vi.fn() }));
vi.mock("./storage", () => ({ native: true, store: { flush: mocks.flush } }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: mocks.check }));
import { checkUpdate, installUpdate } from "./updates";
import type { Update } from "@tauri-apps/plugin-updater";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.flush.mockResolvedValue(undefined);
});
it("background detection requests only update metadata without flushing or modifying notes", async () => {
  mocks.check.mockResolvedValue(null);
  expect(await checkUpdate()).toBe(null);
  expect(mocks.flush).not.toHaveBeenCalled();
  expect(mocks.check).toHaveBeenCalledWith({
    timeout: 20000,
    target: "stable",
  });
});
it("saves before downloading and again before installing; blocks install if save/download fails", async () => {
  const steps: string[] = [],
    progress = vi.fn();
  mocks.flush.mockImplementation(async () => {
    steps.push("save");
  });
  const update = {
    download: vi.fn(async (handler: (event: unknown) => void) => {
      steps.push("download");
      handler({ event: "Started", data: { contentLength: 100 } });
      handler({ event: "Progress", data: { chunkLength: 50 } });
      handler({ event: "Finished" });
    }),
    install: vi.fn(async () => {
      steps.push("install");
    }),
  };
  await installUpdate(update as unknown as Update, progress);
  expect(steps).toEqual(["save", "download", "save", "install"]);
  expect(progress.mock.calls.flat()).toEqual([50, 100]);
  expect(update.install).toHaveBeenCalledWith({ restartAfterInstall: true });
  update.install.mockClear();
  mocks.flush
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error("disk full"));
  await expect(
    installUpdate(update as unknown as Update, progress),
  ).rejects.toThrow("disk full");
  expect(update.install).not.toHaveBeenCalled();
  update.download.mockRejectedValueOnce(new Error("signature/download failed"));
  await expect(
    installUpdate(update as unknown as Update, progress),
  ).rejects.toThrow();
  expect(update.install).not.toHaveBeenCalled();
});
