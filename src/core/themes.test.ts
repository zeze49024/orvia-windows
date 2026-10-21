// @vitest-environment jsdom
import { afterEach, describe, it, expect } from "vitest";
import {
  applyTheme,
  registerTheme,
  resolveTheme,
  restoreThemeHint,
  themeRegistry,
} from "./themes";
import { emptyWorkspace, workspaceSchema } from "./model";

afterEach(() => {
  themeRegistry.splice(2);
  applyTheme("light");
  localStorage.clear();
});
describe("theme registry and compatibility", () => {
  it("defaults existing Beta1–4 workspaces to light while retaining unknown future IDs", () => {
    const old = emptyWorkspace(),
      { theme, ...rest } = old.settings;
    expect(
      workspaceSchema.parse({ ...old, settings: rest }).settings.theme,
    ).toBe("light");
    expect(
      workspaceSchema.parse({
        ...old,
        settings: { ...old.settings, theme: "future-palette" },
      }).settings.theme,
    ).toBe("future-palette");
    expect(resolveTheme("future-palette").id).toBe("light");
  });
  it("restores a dark UI and clears dark overrides when switching back to the original light palette", () => {
    applyTheme("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.style.getPropertyValue("--surface")).toBe(
      "#181b21",
    );
    document.documentElement.classList.remove("dark");
    restoreThemeHint();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    applyTheme("light");
    expect(document.documentElement.style.getPropertyValue("--surface")).toBe(
      "",
    );
    expect(
      document.documentElement.style.getPropertyValue("--background"),
    ).toBe("#ffffff");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
  it("registers future palettes with base inheritance and rejects duplicate or unsafe tokens", () => {
    const theme = {
      id: "midnight",
      names: { "zh-CN": "午夜", "zh-TW": "午夜", en: "Midnight" },
      appearance: "dark" as const,
      variables: { surface: "#101822" },
      preview: ["#101822", "#eeeeee", "#88aaff"] as [string, string, string],
    };
    registerTheme(theme);
    applyTheme("midnight");
    expect(resolveTheme("midnight").id).toBe("midnight");
    expect(document.documentElement.style.getPropertyValue("--surface")).toBe(
      "#101822",
    );
    expect(document.documentElement.style.getPropertyValue("--text")).toBe(
      "#e1e6ee",
    );
    expect(() => registerTheme(theme)).toThrow("INVALID_OR_DUPLICATE_THEME");
    expect(() =>
      registerTheme({
        ...theme,
        id: "bad",
        variables: { surface: "url(https://example.com)" },
      }),
    ).toThrow("INVALID_THEME_COLOR");
  });
});
