export const UPDATE_START_DELAY = 10_000;
export const UPDATE_INTERVAL = 6 * 60 * 60 * 1000;
type Disposable = { close(): Promise<void> };
// Share an in-flight check and release superseded native updater resources.
export class UpdateDiscovery<T extends Disposable> {
  private pending: Promise<T | null> | null = null;
  private current: T | null = null;
  private disposed = false;
  private held = false;
  constructor(
    private fetch: () => Promise<T | null>,
    private publish: (value: T | null) => void,
  ) {}
  check() {
    if (this.disposed) return Promise.resolve(null);
    if (this.held) return Promise.resolve(this.current);
    if (this.pending) return this.pending;
    this.pending = this.fetch()
      .then((value) => {
        if (this.disposed) {
          void value?.close().catch(() => {});
          return null;
        }
        if (this.held) {
          if (value && value !== this.current)
            void value.close().catch(() => {});
          return this.current;
        }
        const previous = this.current;
        this.current = value;
        this.publish(value);
        if (previous && previous !== value)
          void previous.close().catch(() => {});
        return value;
      })
      .finally(() => {
        this.pending = null;
      });
    return this.pending;
  }
  dispose() {
    this.disposed = true;
    void this.current?.close().catch(() => {});
    this.current = null;
  }
  hold() {
    this.held = true;
    return () => {
      this.held = false;
    };
  }
}
export function scheduleUpdateChecks(
  check: () => Promise<unknown>,
  canCheck: () => boolean,
) {
  let deferred: ReturnType<typeof setTimeout> | undefined;
  const tick = () => {
    clearTimeout(deferred);
    if (canCheck()) void check().catch(() => {});
    else deferred = setTimeout(tick, 30_000);
  };
  const initial = setTimeout(tick, UPDATE_START_DELAY);
  const recurring = setInterval(tick, UPDATE_INTERVAL);
  return () => {
    clearTimeout(initial);
    clearInterval(recurring);
    clearTimeout(deferred);
  };
}
