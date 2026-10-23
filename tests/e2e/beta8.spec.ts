import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";

test("capsule controls, favorite state and backup access survive themes, locales and narrow windows", async ({
  page,
}, info) => {
  await page.goto("/");
  await page
    .locator(".page-actions")
    .getByRole("button", { name: "新建文档", exact: true })
    .click();
  await page.getByRole("dialog").locator("input").fill("Beta8 UI 验收");
  await page.getByRole("button", { name: "创建文档", exact: true }).click();
  await page.locator(".live-editor").fill("中文与 English content");
  const favorite = page.locator(".editor-toolbar .favorite-button");
  await expect(favorite).toHaveAttribute("aria-pressed", "false");
  await favorite.click();
  await expect(favorite).toHaveAttribute("aria-pressed", "true");
  const color = await favorite.locator("svg").evaluate((el) => ({
    fill: getComputedStyle(el).fill,
    stroke: getComputedStyle(el).stroke,
  }));
  expect(color.fill).toBe(color.stroke);
  await page.screenshot({ path: info.outputPath("beta8-light.png") });
  await expect(page.locator(".topbar .local-status")).toHaveCount(0);
  await page.locator(".workspace-picker").click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button", { name: "导出完整备份", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 900, height: 760 });
  let current = JSON.parse(
    await fs.readFile("src/i18n/locales/zh-CN.json", "utf8"),
  );
  for (const locale of ["zh-CN", "zh-TW", "en"]) {
    await page.keyboard.press("Control+,");
    await page
      .getByRole("combobox", { name: current.language, exact: true })
      .selectOption(locale);
    current = JSON.parse(
      await fs.readFile(`src/i18n/locales/${locale}.json`, "utf8"),
    );
    await page.keyboard.press("Escape");
    for (const theme of ["dark", "light"]) {
      await page
        .getByRole("button", { name: current.theme, exact: true })
        .click();
      await page
        .getByRole("menuitemradio", {
          name: (
            {
              "zh-CN": { dark: "深色主题", light: "浅色主题" },
              "zh-TW": { dark: "深色主題", light: "淺色主題" },
              en: { dark: "Dark theme", light: "Light theme" },
            } as Record<string, Record<string, string>>
          )[locale][theme],
          exact: true,
        })
        .click();
      const format = page.getByRole("group", {
        name: current.formatGroup,
        exact: true,
      });
      const history = page.getByRole("group", {
        name: current.historyGroup,
        exact: true,
      });
      await expect(
        format.getByRole("button", { name: current.bold, exact: true }),
      ).toBeVisible();
      await expect(history.getByRole("button")).toHaveCount(2);
      const left = (await format.boundingBox())!,
        right = (await history.boundingBox())!;
      expect(left.x + left.width).toBeLessThanOrEqual(right.x);
      expect(right.x + right.width).toBeLessThanOrEqual(900);
      await page
        .getByRole("button", { name: current.sourceMode, exact: true })
        .click();
      await expect(page.locator(".source-editor")).toHaveValue(
        "中文与 English content",
      );
      await page
        .getByRole("button", { name: current.liveEdit, exact: true })
        .click();
      await expect(page.locator(".live-editor")).toHaveText(
        "中文与 English content",
      );
      if (locale === "en" && theme === "dark")
        await page.screenshot({ path: info.outputPath("beta8-dark-900.png") });
    }
  }
  await page.keyboard.press("Control+s");
  await expect(page.locator(".editor-save")).toContainText(current.saved);
  await page.reload();
  await expect(page.locator(".card-footer .favorite-button")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});
