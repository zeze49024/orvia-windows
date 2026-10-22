export type SourceSnapshot = { value: string; from: number; to: number };
/** Session-only undo history, separate from persistent document checkpoints. */
export class SourceHistory {
  private undoStack: SourceSnapshot[] = [];
  private redoStack: SourceSnapshot[] = [];
  private lastTime = 0;
  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }
  record(
    before: SourceSnapshot,
    after: SourceSnapshot,
    group = false,
    now = Date.now(),
  ) {
    if (before.value === after.value) return;
    if (!group || now - this.lastTime > 500 || !this.undoStack.length)
      this.undoStack.push(before);
    this.lastTime = group ? now : 0;
    this.redoStack = [];
    this.bound();
  }
  boundary() {
    this.lastTime = 0;
  }
  reset() {
    this.undoStack = [];
    this.redoStack = [];
    this.boundary();
  }
  undo(current: SourceSnapshot) {
    const previous = this.undoStack.pop();
    if (!previous) return null;
    this.redoStack.push(current);
    this.boundary();
    return previous;
  }
  redo(current: SourceSnapshot) {
    const next = this.redoStack.pop();
    if (!next) return null;
    this.undoStack.push(current);
    this.boundary();
    return next;
  }
  private bound() {
    let size = this.undoStack.reduce((n, item) => n + item.value.length * 2, 0);
    while (
      this.undoStack.length > 100 ||
      (size > 20 * 1024 * 1024 && this.undoStack.length > 1)
    )
      size -= this.undoStack.shift()!.value.length * 2;
  }
}
