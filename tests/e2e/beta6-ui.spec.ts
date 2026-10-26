import { test, expect } from "@playwright/test";
test("find capsule stays next to formatting; motion preferences persist and respect reduced motion", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator(".app-shell").waitFor();
  await page.evaluate(async () => {
    const m = "/src/core/model.ts",
      s = "/src/core/storage.ts";
    const { newDocument } = await import(m);
    const { store } = await import(s);
    store.change((w) => ({
      ...w,
      documents: [
        newDocument(w.libraries[0].id, "Motion fixture", "Original body"),
      ],
    }));
    await store.flush();
  });
  await page
    .locator(".card-main")
    .filter({ hasText: "Motion fixture" })
    .click();
  const a = await page.locator(".format-capsule").boundingBox(),
    b = await page.locator(".find-capsule").boundingBox(),
    c = await page.locator(".history-capsule").boundingBox();
  expect(a && b && c).toBeTruthy();
  expect(b!.x - a!.x - a!.width).toBeGreaterThanOrEqual(10);
  expect(b!.x - a!.x - a!.width).toBeLessThanOrEqual(14);
  expect(Math.abs(a!.height - b!.height)).toBeLessThan(1);
  expect(c!.x).toBeGreaterThan(b!.x + b!.width);
  await page.getByRole("button", { name: "查找与替换", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "查找内容", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+,");
  await page.getByRole("button", { name: "外观", exact: true }).click();
  const select = page.getByRole("combobox", { name: "动画速度", exact: true });
  await expect(select).toHaveValue("moderate");
  for (const [p, ms] of [
    ["elegant", "300ms"],
    ["moderate", "180ms"],
    ["rapid", "70ms"],
  ]) {
    await select.selectOption(p);
    await expect
      .poll(() =>
        page.evaluate(() =>
          getComputedStyle(document.documentElement)
            .getPropertyValue("--motion-page")
            .trim(),
        ),
      )
      .toBe(ms);
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect
    .poll(() =>
      page
        .locator(".motion-preview-indicator")
        .evaluate((e) => getComputedStyle(e).animationName),
    )
    .toBe("none");
  await page.evaluate(async () => {
    const s = "/src/core/storage.ts";
    const { store } = await import(s);
    await store.flush();
  });
  await page.reload();
  await page.locator(".card-main").filter({hasText:"Motion fixture"}).waitFor();
  await page.keyboard.press("Control+,");
  await page.getByRole("button", { name: "外观", exact: true }).click();
  await expect(select).toHaveValue("rapid");
  await page.screenshot({ path: "test-results/beta6-motion-settings.png" });
});
