import { afterEach, expect, it, vi } from "vitest";
import {
  UpdateDiscovery,
  scheduleUpdateChecks,
  UPDATE_INTERVAL,
} from "./update-discovery";
import { emptyWorkspace, workspaceSchema } from "./model";
afterEach(() => vi.useRealTimers());
it("checks after 10 seconds and every six hours, skips busy jobs, cancels timers and stays quiet on failure", async () => {
  vi.useFakeTimers();
  const check = vi.fn().mockRejectedValue(new Error("offline"));
  let busy = false;
  const stop = scheduleUpdateChecks(check, () => !busy);
  await vi.advanceTimersByTimeAsync(9999);
  expect(check).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(check).toHaveBeenCalledTimes(1);
  busy = true;
  await vi.advanceTimersByTimeAsync(UPDATE_INTERVAL - 10000);
  expect(check).toHaveBeenCalledTimes(1);
  busy = false;
  await vi.advanceTimersByTimeAsync(30_000);
  expect(check).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(UPDATE_INTERVAL - 30_000);
  expect(check).toHaveBeenCalledTimes(3);
  stop();
  await vi.advanceTimersByTimeAsync(UPDATE_INTERVAL * 2);
  expect(check).toHaveBeenCalledTimes(3);
});
it("shares concurrent checks, releases replaced resources, and suppresses late publication after dispose", async () => {
  let resolve!: (v: { close: () => Promise<void> } | null) => void;
  const fetch = vi.fn(
      () =>
        new Promise<{ close: () => Promise<void> } | null>((r) => {
          resolve = r;
        }),
    ),
    publish = vi.fn();
  const monitor = new UpdateDiscovery(fetch, publish),
    first = monitor.check(),
    second = monitor.check();
  expect(first).toBe(second);
  expect(fetch).toHaveBeenCalledTimes(1);
  const old = { close: vi.fn().mockResolvedValue(undefined) };
  resolve(old);
  await first;
  expect(publish).toHaveBeenCalledWith(old);
  const next = monitor.check();
  resolve(null);
  await next;
  expect(old.close).toHaveBeenCalledTimes(1);
  const late = monitor.check();
  monitor.dispose();
  const value = { close: vi.fn().mockResolvedValue(undefined) };
  resolve(value);
  await late;
  expect(value.close).toHaveBeenCalledTimes(1);
  expect(publish).toHaveBeenCalledTimes(2);
});
it("old workspaces enable automatic detection and an opt-out persists", () => {
  const old = JSON.parse(JSON.stringify(emptyWorkspace()));
  delete old.settings.autoUpdate;
  expect(workspaceSchema.parse(old).settings.autoUpdate).toBe(true);
  old.settings.autoUpdate = false;
  expect(workspaceSchema.parse(old).settings.autoUpdate).toBe(false);
});

it("does not close an installing resource when an earlier background check returns", async () => {
  const old = { close: vi.fn().mockResolvedValue(undefined) },
    next = { close: vi.fn().mockResolvedValue(undefined) };
  let resolve!: (v: typeof old) => void;
  const fetch = vi
      .fn()
      .mockResolvedValueOnce(old)
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolve = r;
          }),
      ),
    publish = vi.fn();
  const monitor = new UpdateDiscovery(fetch, publish);
  await monitor.check();
  const pending = monitor.check(),
    release = monitor.hold();
  resolve(next);
  await pending;
  expect(old.close).not.toHaveBeenCalled();
  expect(next.close).toHaveBeenCalledTimes(1);
  expect(publish).toHaveBeenCalledTimes(1);
  expect(await monitor.check()).toBe(old);
  release();
  monitor.dispose();
  expect(old.close).toHaveBeenCalledTimes(1);
});
