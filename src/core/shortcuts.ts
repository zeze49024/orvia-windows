export const defaultShortcuts = {
  searchAll: "Ctrl+K",
  newNote: "Ctrl+N",
  settings: "Ctrl+,",
  save: "Ctrl+S",
  find: "Ctrl+F",
  replace: "Ctrl+H",
  lockVault: "Ctrl+Shift+L",
};
export function normalizeShortcut(input: string) {
  const parts = input
    .trim()
    .split("+")
    .map((p) => p.trim());
  const key = parts.pop()?.toUpperCase();
  if (
    !key ||
    !/^[A-Z0-9,./;]$/.test(key) ||
    !parts.length ||
    parts.some((p) => !["CTRL", "SHIFT", "ALT"].includes(p.toUpperCase())) ||
    new Set(parts.map((p) => p.toUpperCase())).size !== parts.length
  )
    throw new Error("SHORTCUT_FORMAT");
  const mods = ["Ctrl", "Alt", "Shift"].filter((m) =>
    parts.some((p) => p.toUpperCase() === m.toUpperCase()),
  );
  if (
    !mods.includes("Ctrl") ||
    mods.includes("Alt") ||
    [
      "Z",
      "Y",
      "C",
      "V",
      "X",
      "A",
      "W",
      "Q",
      "P",
      "B",
      "I",
      "U",
      "O",
      "R",
      "E",
    ].includes(key)
  )
    throw new Error("SHORTCUT_RESERVED");
  return [...mods, key].join("+");
}
export function validateShortcuts(values: typeof defaultShortcuts) {
  const normalized = Object.fromEntries(
    Object.entries(values).map(([k, v]) => [k, normalizeShortcut(v)]),
  ) as typeof defaultShortcuts;
  if (
    new Set(Object.values(normalized)).size !== Object.keys(normalized).length
  )
    throw new Error("SHORTCUT_CONFLICT");
  return normalized;
}
export function matchesShortcut(event: KeyboardEvent, shortcut: string) {
  try {
    const parts = normalizeShortcut(shortcut).split("+");
    return (
      !event.isComposing &&
      !event.altKey &&
      (event.ctrlKey || event.metaKey) &&
      event.shiftKey === parts.includes("Shift") &&
      event.key.toUpperCase() === parts.at(-1)
    );
  } catch {
    return false;
  }
}
