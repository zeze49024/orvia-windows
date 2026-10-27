import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.locator(".app-shell").waitFor();
  await page.evaluate(async () => {
    const model = "/src/core/model.ts",
      storage = "/src/core/storage.ts";
    const { newDocument } = await import(model),
      { store } = await import(storage);
    store.change((s) => ({
      ...s,
      documents: [
        newDocument(
          s.libraries[0].id,
          "磨砂工具栏",
          "# 悬浮工具栏\n\n" +
            Array.from(
              { length: 70 },
              (_, i) =>
                `第 ${i + 1} 段：滚动正文时，只有胶囊本身呈现磨砂玻璃，间隙保持透明。`,
            ).join("\n\n"),
        ),
      ],
    }));
    await store.flush();
  });
});

test("both search fields are outlined pills, distinguish their surfaces and keep filtering usable", async ({
  page,
}) => {
  for (const theme of ["light", "dark"]) {
    await page.evaluate(async (theme) => {
      const path = "/src/core/storage.ts";
      const { store } = await import(path);
      store.change((s) => ({ ...s, settings: { ...s.settings, theme } }));
    }, theme);
    for (const name of [".home-search", ".inline-search"]) {
      const field = page.locator(name);
      const css = await field.evaluate((el) => {
        const s = getComputedStyle(el);
        return {
          radius: parseFloat(s.borderRadius),
          height: el.getBoundingClientRect().height,
          border: s.borderTopWidth,
          color: s.borderColor,
          background: s.backgroundColor,
        };
      });
      expect(css.radius).toBeGreaterThanOrEqual(css.height / 2);
      expect(css.border).toBe("1px");
      expect(css.color).not.toBe("rgba(0, 0, 0, 0)");
      if (name === ".inline-search")
        expect(css.background).not.toBe(
          await page
            .locator(".page-content")
            .evaluate((el) => getComputedStyle(el).backgroundColor),
        );
    }
    const search = page.locator(".home-search input");
    const before = await page
      .locator(".home-search")
      .evaluate((el) => getComputedStyle(el).borderColor);
    await search.fill("找不到这篇");
    await expect(page.locator(".document-card")).toHaveCount(0);
    expect(
      await page
        .locator(".home-search")
        .evaluate((el) => getComputedStyle(el).borderColor),
    ).not.toBe(before);
    await search.fill("");
    await page.locator(".inline-search input").fill("磨砂");
    await expect(page.locator(".document-card")).toHaveCount(1);
    await page.locator(".inline-search input").fill("");
    await page.locator(".page-intro h1").click();
    await page.screenshot({ path: `test-results/rc2-search-${theme}.png` });
  }
  await page.setViewportSize({ width: 820, height: 780 });
  expect(
    await page
      .locator(".document-controls")
      .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBe(true);
});

test("glass capsules float over scrolled text while the transparent gaps pass pointer events through", async ({
  page,
}) => {
  await page.locator(".card-main").filter({ hasText: "磨砂工具栏" }).click();
  await expect(page.locator(".live-editor")).toBeVisible();
  for (const theme of ["light", "dark"]) {
    await page.evaluate(async (theme) => {
      const path = "/src/core/storage.ts";
      const { store } = await import(path);
      store.change((s) => ({ ...s, settings: { ...s.settings, theme } }));
    }, theme);
    await page.locator(".editor-layout").evaluate((el) => {
      el.scrollTop = 420;
    });
    const bar = page.locator(".live-format-bar");
    expect(
      await bar.evaluate((el) => getComputedStyle(el).backgroundColor),
    ).toBe("rgba(0, 0, 0, 0)");
    expect(await bar.evaluate((el) => getComputedStyle(el).boxShadow)).toBe(
      "none",
    );
    for (const capsule of await page
      .locator(".live-format-bar .editor-capsule")
      .all()) {
      const css = await capsule.evaluate((el) => {
        const s = getComputedStyle(el);
        return {
          filter: s.backdropFilter,
          background: s.backgroundColor,
          pointer: s.pointerEvents,
        };
      });
      expect(css.filter).toContain("blur(16px)");
      expect(css.background).toMatch(/rgba|\/ 0\./);
      expect(css.pointer).toBe("auto");
    }
    const format = await page.locator(".format-capsule").boundingBox();
    const find = await page.locator(".find-capsule").boundingBox();
    expect(find!.x - format!.x - format!.width).toBeGreaterThanOrEqual(10);
    const blocked = await page.evaluate(
      ({ x, y }) =>
        !!document.elementFromPoint(x, y)?.closest(".live-format-bar"),
      { x: format!.x + format!.width + 6, y: format!.y + format!.height / 2 },
    );
    expect(blocked).toBe(false);
    await expect(bar).toBeInViewport();
    await page.screenshot({ path: `test-results/rc2-glass-${theme}.png` });
    await page.getByRole("button", { name: "标题", exact: true }).click();
    await expect(
      page.getByRole("menuitemradio", { name: "标题 1 H1", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "查找与替换", exact: true }).click();
    await expect(
      page.getByRole("textbox", { name: "查找内容", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
  }
});
