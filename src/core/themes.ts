import type { Locale } from "../i18n/registry";

export const themeTokens = [
  "background",
  "foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "border",
  "input",
  "ring",
  "surface",
  "surface-alt",
  "surface-soft",
  "surface-hover",
  "line",
  "text",
  "text-secondary",
  "text-muted",
  "text-faint",
  "on-solid",
  "blue",
  "blue-bg",
  "green",
  "green-bg",
  "purple",
  "purple-bg",
  "amber",
  "amber-bg",
  "rose",
  "rose-bg",
  "red",
  "red-bg",
  "logo-color",
  "favorite",
] as const;
export type ThemeToken = (typeof themeTokens)[number];
export interface ThemeDefinition {
  id: string;
  names: Record<Locale, string>;
  appearance: "light" | "dark";
  variables: Partial<Record<ThemeToken, string>>;
  preview: [string, string, string];
}
export const themeRegistry: ThemeDefinition[] = [
  {
    id: "light",
    names: { "zh-CN": "浅色主题", "zh-TW": "淺色主題", en: "Light theme" },
    appearance: "light",
    // Shared semantic tokens keep secondary text readable across all views.
    variables: {
      background: "#ffffff",
      foreground: "#202124",
      primary: "#2563eb",
      "primary-foreground": "#ffffff",
      secondary: "#f3f3f3",
      "secondary-foreground": "#343434",
      muted: "#f6f6f6",
      "muted-foreground": "#667487",
      accent: "#f0f1f3",
      "accent-foreground": "#202124",
      destructive: "#dc4545",
      border: "#e9e9ec",
      input: "#e2e3e7",
      ring: "#2563eb",
      surface: "#ffffff",
      "surface-alt": "#f8f9fb",
      "surface-soft": "#f3f5f8",
      "surface-hover": "#eef1f5",
      line: "#e2e7ee",
      text: "#263140",
      "text-secondary": "#536174",
      "text-muted": "#667487",
      "text-faint": "#6d7b8d",
      "on-solid": "#ffffff",
      blue: "#285db5",
      "blue-bg": "#edf3fc",
      green: "#22745b",
      "green-bg": "#edf6f2",
      red: "#be3b40",
      "red-bg": "#fdf0f0",
      favorite: "#e6ad00",
    },
    preview: ["#ffffff", "#202124", "#659dc3"],
  },
  {
    id: "dark",
    names: { "zh-CN": "深色主题", "zh-TW": "深色主題", en: "Dark theme" },
    appearance: "dark",
    variables: {
      background: "#181b21",
      foreground: "#e5e8ed",
      primary: "#5488ec",
      "primary-foreground": "#ffffff",
      secondary: "#282d36",
      "secondary-foreground": "#dce1ea",
      muted: "#222730",
      "muted-foreground": "#a1aab8",
      accent: "#303846",
      "accent-foreground": "#e5e8ed",
      destructive: "#e56e76",
      border: "#333a46",
      input: "#3d4654",
      ring: "#77a4ef",
      surface: "#181b21",
      "surface-alt": "#1f232b",
      "surface-soft": "#252b35",
      "surface-hover": "#303846",
      line: "#333a46",
      text: "#e1e6ee",
      "text-secondary": "#c1c9d5",
      "text-muted": "#a0aabb",
      "text-faint": "#9aa7ba",
      "on-solid": "#ffffff",
      blue: "#8aaff0",
      "blue-bg": "#263650",
      green: "#7dc6a7",
      "green-bg": "#233d33",
      purple: "#baa1e7",
      "purple-bg": "#352d48",
      amber: "#dcc08a",
      "amber-bg": "#403728",
      rose: "#dfa3ba",
      "rose-bg": "#442e3b",
      red: "#ee929a",
      "red-bg": "#462b31",
      "logo-color": "#e1e6ee",
      favorite: "#facc15",
    },
    preview: ["#181b21", "#e5e8ed", "#8aaff0"],
  },
];

// Extension point: register a palette before mounting React; controls discover it
// automatically. Persisted string IDs allow adding themes without schema changes.
export function registerTheme(theme: ThemeDefinition) {
  if (
    !/^[a-z][a-z0-9-]{0,63}$/.test(theme.id) ||
    themeRegistry.some((item) => item.id === theme.id)
  )
    throw new Error("INVALID_OR_DUPLICATE_THEME");
  if (
    !["light", "dark"].includes(theme.appearance) ||
    !["zh-CN", "zh-TW", "en"].every((locale) =>
      Boolean(theme.names[locale as Locale]),
    )
  )
    throw new Error("INVALID_THEME");
  for (const [key, value] of Object.entries(theme.variables)) {
    if (
      !themeTokens.includes(key as ThemeToken) ||
      !/^#(?:[a-f0-9]{3,4}|[a-f0-9]{6}|[a-f0-9]{8})$/i.test(value)
    )
      throw new Error("INVALID_THEME_COLOR");
  }
  themeRegistry.push(theme);
}
export const resolveTheme = (id?: string) =>
  themeRegistry.find((theme) => theme.id === id) ?? themeRegistry[0];
export function applyTheme(id: string) {
  const theme = resolveTheme(id),
    root = document.documentElement;
  const base = themeRegistry.find((item) => item.id === theme.appearance)!;
  for (const token of themeTokens) root.style.removeProperty("--" + token);
  for (const [token, value] of Object.entries({
    ...base.variables,
    ...theme.variables,
  }))
    root.style.setProperty("--" + token, value);
  root.dataset.theme = theme.id;
  root.style.colorScheme = theme.appearance;
  root.classList.toggle("dark", theme.appearance === "dark");
  try {
    localStorage.setItem("orvia-theme", theme.id);
  } catch {
    /* UI cache is optional. SQLite remains authoritative. */
  }
}
export function restoreThemeHint() {
  try {
    applyTheme(localStorage.getItem("orvia-theme") ?? "light");
  } catch {
    applyTheme("light");
  }
}
