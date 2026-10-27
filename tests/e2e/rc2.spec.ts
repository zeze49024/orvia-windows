import { test, expect, type Page } from "@playwright/test";

async function seed(page: Page) {
  await page.goto("/");
  await expect(page.locator(".page-content")).toBeVisible();
  await page.evaluate(async () => {
    const storagePath = "/src/core/storage.ts",
      modelPath = "/src/core/model.ts";
    const { store } = await import(storagePath),
      { emptyWorkspace, newDocument } = await import(modelPath);
    const data = emptyWorkspace();
    data.libraries[0].name = "工作笔记";
    data.libraries.push({
      id: crypto.randomUUID(),
      name: "归档资料",
      color: "green",
    });
    data.documents = [
      newDocument(data.libraries[0].id, "A笔记", "正文 A"),
      newDocument(data.libraries[0].id, "B笔记", "正文 B"),
    ];
    store.change(() => data);
    await store.flush();
  });
}
const approve = (page: Page) =>
  page
    .getByRole("alertdialog")
    .getByRole("button", { name: "确认", exact: true })
    .click();
const cancel = (page: Page) =>
  page
    .getByRole("alertdialog")
    .getByRole("button", { name: "取消", exact: true })
    .click();

test("right-click, batch and editor deletes require confirmation; cancel and Escape leave notes intact", async ({
  page,
}, info) => {
  await seed(page);
  const card = page.locator(".document-card").filter({ hasText: "A笔记" });
  await card.click({ button: "right" });
  await page.getByRole("menuitem", { name: "删除", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toContainText("A笔记");
  await expect(
    page
      .getByRole("alertdialog")
      .getByRole("button", { name: "取消", exact: true }),
  ).toBeFocused();
  await page.screenshot({
    path: info.outputPath("rc2-delete-confirmation.png"),
  });
  await page.keyboard.press("Escape");
  await expect(card).toBeVisible();
  await card.click({ button: "right" });
  await page.getByRole("menuitem", { name: "多选", exact: true }).click();
  await page.getByRole("checkbox", { name: "全选", exact: true }).check();
  await page
    .locator(".batch-capsule")
    .getByRole("button", { name: "删除", exact: true })
    .click();
  await expect(page.getByRole("alertdialog")).toContainText("B笔记");
  await cancel(page);
  await expect(page.locator(".document-card")).toHaveCount(2);
  await page.getByRole("button", { name: "退出多选", exact: true }).click();
  await card.locator(".card-main").click();
  await page.getByRole("button", { name: "移入回收站", exact: true }).click();
  await cancel(page);
  await expect(page.locator(".live-editor")).toContainText("正文 A");
  await page.getByRole("button", { name: "移入回收站", exact: true }).click();
  await approve(page);
  await expect(page.locator(".document-card")).toHaveCount(1);
  await page.locator(".document-card").click({ button: "right" });
  await page.getByRole("menuitem", { name: "多选", exact: true }).click();
  await page
    .locator(".batch-capsule")
    .getByRole("button", { name: "删除", exact: true })
    .click();
  await approve(page);
  await expect(page.locator(".document-card")).toHaveCount(0);
  await page.locator(".sidebar .nav-row").filter({ hasText: "回收站" }).click();
  await expect(page.locator(".document-card")).toHaveCount(2);
  await page.locator(".card-main").filter({ hasText: "A笔记" }).click();
  await page.getByRole("button", { name: "永久删除", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("A笔记");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await page.keyboard.press("Control+s");
  await expect(page.locator(".editor-save")).toContainText("已保存");
  await page.reload();
  await page.locator(".sidebar .nav-row").filter({ hasText: "回收站" }).click();
  await expect(page.locator(".document-card")).toHaveCount(2);
});

test("metadata and bulk moves show destination, only apply after confirmation, library deletion confirms too", async ({
  page,
}, info) => {
  await seed(page);
  await page.locator(".card-main").filter({ hasText: "A笔记" }).click();
  await page.getByRole("button", { name: "文档选项", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("combobox", { name: "所属知识库", exact: true })
    .selectOption({ label: "归档资料" });
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toContainText("归档资料");
  await cancel(page);
  await expect(dialog).toBeVisible();
  await expect(page.locator(".breadcrumbs")).toContainText("工作笔记");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await approve(page);
  await expect(page.locator(".breadcrumbs")).toContainText("归档资料");
  await page
    .locator(".editor-toolbar")
    .getByRole("button", { name: "返回", exact: true })
    .click();
  await page.locator(".document-card").first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "多选", exact: true }).click();
  await page.getByRole("checkbox", { name: "全选", exact: true }).check();
  await page.getByRole("button", { name: "移动到", exact: true }).click();
  await dialog.getByRole("button", { name: "工作笔记", exact: true }).click();
  await page.screenshot({ path: info.outputPath("rc2-move-confirmation.png") });
  await cancel(page);
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "工作笔记", exact: true }).click();
  await approve(page);
  await page
    .locator(".library-row")
    .filter({ hasText: "归档资料" })
    .locator(".library-menu")
    .click();
  await dialog.getByRole("button", { name: "删除知识库", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toContainText("归档资料");
  await cancel(page);
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "删除知识库", exact: true }).click();
  await approve(page);
  await expect(page.locator(".library-row")).toHaveCount(1);
});

async function mockUpdates(page: Page) {
  await page.addInitScript(() => {
    Object.assign(window, {
      __checks: 0,
      __installs: 0,
      __offline: false,
      __done: false,
    });
  });
  await page.route("**/src/core/updates.ts*", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `
    import {store} from '/src/core/storage.ts';
    export const supportsUpdates=true;
    export async function checkUpdate(){window.__checks++; if(window.__offline)throw new Error('offline');return {version:'0.1.0-rc99',body:'测试更新',close:async()=>{}};}
    export async function installUpdate(update,progress){await store.flush();window.__installs++;progress(50);await new Promise(r=>{window.__completeUpdate=r});await store.flush();window.__savedBody=store.data.documents[0]?.body;window.__done=true;progress(100);}
  `,
    }),
  );
  await page.clock.install();
}
test("automatic discovery places a blue/white badge before window controls and installs directly on click", async ({
  page,
}, info) => {
  await mockUpdates(page);
  await seed(page);
  await page.clock.fastForward(10_000);
  const badge = page.getByRole("button", { name: "检测到新版本", exact: true });
  await expect(badge).toBeVisible();
  await expect(badge.locator("svg")).toHaveClass(/lucide-arrow-down-to-line/);
  expect(
    await badge.locator("svg").evaluate((e) => getComputedStyle(e).stroke),
  ).toBe("rgb(255, 255, 255)");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const colors = await badge.evaluate((e) => ({
    background: getComputedStyle(e).backgroundColor,
    color: getComputedStyle(e).color,
  }));
  expect(colors).toEqual({
    background: "rgb(37, 99, 235)",
    color: "rgb(255, 255, 255)",
  });
  const b = (await badge.boundingBox())!,
    controls = (await page.locator(".window-actions").boundingBox())!;
  expect(b.y + b.height).toBeLessThanOrEqual(40);
  expect(b.x + b.width).toBeLessThan(controls.x);
  await page.screenshot({
    path: info.outputPath("rc2-update-badge-light.png"),animations:"disabled",
  });
  await page.getByRole("button", { name: "切换主题", exact: true }).click();
  await page
    .getByRole("menuitemradio", { name: "深色主题", exact: true })
    .click();
  await page.setViewportSize({ width: 900, height: 760 });
  await page.screenshot({
    path: info.outputPath("rc2-update-badge-dark-900.png"),animations:"disabled",
  });
  await page.locator(".card-main").filter({ hasText: "A笔记" }).click();
  await page.locator(".live-editor").fill("更新前最后一次编辑");
  await badge.click();
  await expect(page.getByRole("progressbar")).toBeVisible();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button", { name: "下载并安装更新", exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("Control+,");
  await expect(page.getByRole("progressbar")).toBeVisible();
  await expect(page.locator(".update-badge")).toBeDisabled();
  await expect(page.getByRole("progressbar")).toHaveAttribute("value", "50");
  await page.evaluate("window.__completeUpdate()");
  await expect.poll(() => page.evaluate("window.__done")).toBe(true);
  expect(await page.evaluate("window.__installs")).toBe(1);
  expect(await page.evaluate("window.__savedBody")).toBe("更新前最后一次编辑");
});
test("automatic failures stay quiet, retry on schedule; disabled setting persists and manual checks still work", async ({
  page,
}) => {
  await mockUpdates(page);
  await seed(page);
  await page.evaluate("window.__offline=true");
  await page.clock.fastForward(10_000);
  await expect.poll(() => page.evaluate("window.__checks")).toBe(1);
  await expect(page.locator(".toast")).toHaveCount(0);
  await expect(page.locator(".update-badge")).toHaveCount(0);
  await page.evaluate("window.__offline=false");
  await page.clock.fastForward(6 * 60 * 60 * 1000);
  await expect(page.locator(".update-badge")).toBeVisible();
  await page.keyboard.press("Control+,");
  await page
    .locator(".settings-nav nav")
    .getByRole("button", { name: "版本与更新", exact: true })
    .click();
  const toggle = page.getByRole("switch", {
    name: "自动检测新版本",
    exact: true,
  });
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await page.keyboard.press("Control+s");
  // Saving is asynchronous; a forced reload must wait for the persistence boundary,
  // rather than racing the queued IndexedDB transaction on slower Windows runners.
  await page.evaluate(async () => {
    const storagePath = "/src/core/storage.ts";
    const { store } = await import(storagePath);
    await store.flush();
  });
  await page.reload();
  await expect(page.locator(".page-content")).toBeVisible();
  await page.clock.fastForward(10_000);
  expect(await page.evaluate("window.__checks")).toBe(0);
  await page.keyboard.press("Control+,");
  await page
    .locator(".settings-nav nav")
    .getByRole("button", { name: "版本与更新", exact: true })
    .click();
  await expect(toggle).not.toBeChecked();
  await page.getByRole("button", { name: "检查更新", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("rc99");
  expect(await page.evaluate("window.__checks")).toBe(1);
});
