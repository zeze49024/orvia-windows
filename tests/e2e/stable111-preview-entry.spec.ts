import { test, expect } from "@playwright/test";

test("feature preview sits after favorites, shows one transient hint and never navigates or loses editing", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto("/");
  await page.locator(".app-shell").waitFor();
  const entry = page.getByRole("button", { name: "新功能开发中", exact: true });
  const navLabels = await page
    .locator(".sidebar > .nav-group")
    .first()
    .locator("button")
    .allTextContents();
  expect(navLabels.at(-2)).toContain("星标文档");
  expect(navLabels.at(-1)).toBe("新功能开发中");
  const title = await page.locator(".page-intro h1").textContent();
  await entry.click();
  await expect(page.locator(".toast")).toHaveText("⚠️新功能开发中，敬请期待！");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".page-intro h1")).toHaveText(title!);
  await page.screenshot({
    path: "test-results/v011-feature-hint.png",
    animations: "disabled",
  });
  await page.clock.fastForward(2700);
  await expect(page.locator(".toast")).toHaveCount(0);
  await page.evaluate(async () => {
    const a = "/src/core/model.ts",
      b = "/src/core/storage.ts";
    const { newDocument } = await import(a),
      { store } = await import(b);
    store.change((s) => ({
      ...s,
      documents: [
        newDocument(s.libraries[0].id, "预告入口验证", "编辑中的正文"),
      ],
    }));
    await store.flush();
  });
  await page.locator(".card-main").filter({ hasText: "预告入口验证" }).click();
  await page.locator(".live-editor").fill("保留正在编辑的内容");
  await entry.click();
  await expect(page.locator(".live-editor")).toHaveText("保留正在编辑的内容");
  await expect(page.locator(".toast span")).toHaveText(
    "⚠️新功能开发中，敬请期待！",
  );
  await entry.click();
  await expect(page.locator(".toast")).toHaveCount(1);
  await page.clock.fastForward(2700);
  await expect(page.locator(".toast")).toHaveCount(0);
  await expect(page.locator(".live-editor")).toHaveText("保留正在编辑的内容");
});
