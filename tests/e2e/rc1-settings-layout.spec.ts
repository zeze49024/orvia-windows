import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/src/core/ai-transport.ts", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `export const aiAvailable=true;let config={enabled:false,provider:'deepseek',model:'deepseek-flash',maxOutputTokens:2048,maxInputChars:32000,maxRounds:3};export const aiTransport={load:async()=>({config:{...config},hasKey:false,authorized:false}),save:async(c)=>{config={...c}},models:async()=>[]};`,
    }),
  );
  await page.goto("/");
  await page.locator(".app-shell").waitFor();
  await page.keyboard.press("Control+,");
});

test("all settings pages retain their controls and stay within the viewport in both themes", async ({
  page,
}) => {
  const nav = page.locator(".settings-nav nav button");
  await expect(nav).toHaveCount(9);
  const names = await nav.allTextContents();
  expect(names.slice(0, 3)).toEqual(["常规", "外观", "AI 与模型"]);
  for (const theme of ["light", "dark"]) {
    await page.evaluate(async (theme) => {
      const path = "/src/core/storage.ts";
      const { store } = await import(path);
      store.change((s) => ({ ...s, settings: { ...s.settings, theme } }));
    }, theme);
    for (const width of [1440, 900, 680]) {
      await page.setViewportSize({ width, height: 900 });
      for (const name of names) {
        await page
          .locator(".settings-nav nav")
          .getByRole("button", { name, exact: true })
          .click();
        await expect(page.locator(".settings-page-heading h2")).toHaveText(
          name,
        );
        await expect(page.getByRole("dialog")).toHaveCount(0);
        expect(
          await page
            .locator(".settings-content")
            .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
        ).toBe(true);
        expect(
          await page
            .locator(".settings-nav")
            .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
        ).toBe(true);
        for (const el of await page
          .locator(".settings-card :is(input,select,textarea,button)")
          .all()) {
          if (!(await el.isVisible())) continue;
          const box = await el.boundingBox();
          expect(box!.x).toBeGreaterThanOrEqual(0);
          expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
        }
        if (
          width === 1440 &&
          ["AI 与模型", "存储与备份", "模板与快捷键"].includes(name)
        ) {
          await page.screenshot({
            path: `test-results/settings-rc1-${theme}-${names.indexOf(name)}.png`,
          });
        }
      }
    }
  }
});

test("AI fields align, compact rows stay readable, and settings remain functional", async ({
  page,
}) => {
  await page
    .locator(".settings-nav nav")
    .getByRole("button", { name: "AI 与模型", exact: true })
    .click();
  const provider = page.getByRole("combobox", { name: "服务商", exact: true });
  const model = page.getByLabel("模型 ID", { exact: true });
  const a = await provider.boundingBox(),
    b = await model.boundingBox();
  expect(Math.abs(a!.y - b!.y)).toBeLessThan(2);
  await page
    .getByRole("combobox", { name: "每轮输出 Token 上限", exact: true })
    .selectOption("4096");
  await page.getByRole("button", { name: "保存 AI 设置", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("AI 设置已保存");
  await page
    .locator(".settings-nav nav")
    .getByRole("button", { name: "常规", exact: true })
    .click();
  const rows = await page.locator(".settings-row").all();
  for (const row of rows) {
    expect((await row.boundingBox())!.height).toBeLessThanOrEqual(76);
    expect(
      parseFloat(await row.evaluate((el) => getComputedStyle(el).fontSize)),
    ).toBeGreaterThanOrEqual(13);
  }
  await page
    .getByRole("combobox", { name: "界面语言", exact: true })
    .selectOption("en");
  await expect(page.locator(".settings-page-heading h2")).toHaveText("General");
  await page
    .getByRole("combobox", { name: "Interface language", exact: true })
    .selectOption("zh-TW");
  await expect(page.locator(".settings-page-heading h2")).toHaveText("一般");
});

test("English and Traditional Chinese settings remain readable without horizontal overflow", async ({
  page,
}) => {
  for (const locale of ["en", "zh-TW"]) {
    await page.evaluate(async (locale) => {
      const path = "/src/core/storage.ts";
      const { store } = await import(path);
      store.change((s) => ({ ...s, settings: { ...s.settings, locale } }));
    }, locale);
    await page.setViewportSize({ width: 900, height: 820 });
    const nav = page.locator(".settings-nav nav button");
    for (let index = 0; index < 9; index++) {
      await nav.nth(index).click();
      expect(
        await page
          .locator(".settings-content")
          .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      ).toBe(true);
      expect(
        await page
          .locator(".settings-card")
          .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      ).toBe(true);
    }
  }
});
