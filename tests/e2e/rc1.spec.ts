import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import { unzipSync } from "fflate";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".page-content")).toBeVisible();
  await page.evaluate(async () => {
    const storagePath = "/src/core/storage.ts",
      modelPath = "/src/core/model.ts";
    const { store, putAsset } = await import(storagePath),
      { emptyWorkspace, newDocument } = await import(modelPath);
    const data = emptyWorkspace();
    data.libraries[0].name = "工作笔记";
    data.libraries.push({
      id: crypto.randomUUID(),
      name: "归档资料",
      color: "green",
    });
    const asset = await putAsset(
      Uint8Array.from(
        atob(
          "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFUlEQVR4nGP0rrj0nwEJMCFziBMAAKj3ApyajjcEAAAAAElFTkSuQmCC",
        ),
        (c) => c.charCodeAt(0),
      ),
      "image/png",
    );
    data.assets.push(asset);
    data.documents = [
      newDocument(
        data.libraries[0].id,
        "A笔记",
        `# 正文\n\n![本地图](asset:${asset.id})`,
      ),
      newDocument(data.libraries[0].id, "B笔记", "中文内容"),
      newDocument(data.libraries[0].id, "C笔记", "备用内容"),
    ];
    data.documents[0].starred = true;
    store.change(() => data);
    await store.flush();
  });
});

test("context menus cover all lists, pin/move/delete stay independent and persist", async ({
  page,
}, info) => {
  for (const name of ["最近打开", "星标文档", "工作笔记", "全部文档"]) {
    await page
      .locator(".sidebar .nav-row")
      .filter({ hasText: name })
      .first()
      .click();
    await page.locator(".document-card").first().click({ button: "right" });
    await expect(
      page.getByRole("menuitem", { name: "删除", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: "多选", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
  }
  await page
    .locator(".document-card")
    .filter({ hasText: "B笔记" })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "多选", exact: true }).click();
  await page.getByRole("checkbox", { name: "多选 C笔记", exact: true }).check();
  await expect(page.locator(".batch-bar")).toContainText("2");
  await page.screenshot({ path: info.outputPath("rc1-selection-light.png") });
  await page.getByRole("button", { name: "置顶", exact: true }).click();
  await expect(page.locator(".document-card").first()).not.toContainText(
    "A笔记",
  );
  await expect(
    page
      .locator(".document-card")
      .filter({ hasText: "A笔记" })
      .locator(".favorite-button"),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .locator(".document-card")
    .filter({ hasText: "B笔记" })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "多选", exact: true }).click();
  await page.getByRole("checkbox", { name: "多选 C笔记", exact: true }).check();
  await page.getByRole("button", { name: "移动到", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "归档资料", exact: true })
    .click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "确认", exact: true })
    .click();
  await page
    .locator(".sidebar .nav-row")
    .filter({ hasText: "归档资料" })
    .click();
  await expect(page.locator(".document-card")).toHaveCount(2);
  await page
    .locator(".document-card")
    .filter({ hasText: "B笔记" })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "删除", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "确认", exact: true })
    .click();
  await expect(page.locator(".document-card")).toHaveCount(1);
  await page.locator(".sidebar .nav-row").filter({ hasText: "回收站" }).click();
  await expect(page.locator(".document-card")).toContainText("B笔记");
  await page
    .getByRole("button", { name: "恢复文档 B笔记", exact: true })
    .click();
  await page.keyboard.press("Control+s");
  await page.reload();
  await expect(page.locator(".document-card")).toHaveCount(3);
  await expect(page.locator(".card-main h3 .lucide-pin")).toHaveCount(2);
});

test("batch exports independent Markdown, ZIP and offline HTML; settings is searchable and keeps editor", async ({
  page,
}, info) => {
  await page.locator(".document-card").first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "多选", exact: true }).click();
  await page.getByRole("checkbox", { name: "全选", exact: true }).check();
  await page.getByRole("button", { name: "导出", exact: true }).click();
  let pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "ZIP 压缩包", exact: true }).click();
  let file = await pending,
    bytes = await fs.readFile((await file.path())!);
  const archive = unzipSync(bytes);
  expect(Object.keys(archive)).toHaveLength(3);
  expect(new TextDecoder().decode(archive["A笔记.md"])).toContain(
    "data:image/png;base64",
  );
  await page.getByRole("button", { name: "导出", exact: true }).click();
  const downloads: import("@playwright/test").Download[] = [];
  page.on("download", (d) => downloads.push(d));
  await page
    .getByRole("button", { name: "独立 .md 文件", exact: true })
    .click();
  await expect.poll(() => downloads.length).toBe(3);
  expect(downloads.map((d) => d.suggestedFilename()).sort()).toEqual([
    "A笔记.md",
    "B笔记.md",
    "C笔记.md",
  ]);
  await page.getByRole("button", { name: "分享", exact: true }).click();
  pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "保存 HTML 文件", exact: true })
    .click();
  file = await pending;
  const html = await fs.readFile((await file.path())!, "utf8");
  expect(html).toContain("data:image/png;base64");
  expect(html).toContain("中文内容");
  await page.getByRole("button", { name: "退出多选", exact: true }).click();
  await page.locator(".card-main").filter({ hasText: "A笔记" }).click();
  await page.locator(".live-editor").fill("设置前的编辑内容");
  await page.keyboard.press("Control+,");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".settings-nav nav button")).toHaveCount(9);
  await page.screenshot({ path: info.outputPath("rc1-settings-light.png") });
  await page
    .getByRole("textbox", { name: "搜索设置", exact: true })
    .fill("备份");
  await expect(page.locator(".settings-content")).toContainText("导出完整备份");
  await page
    .getByRole("textbox", { name: "搜索设置", exact: true })
    .fill("不存在的设置");
  await expect(page.locator(".settings-content")).toContainText(
    "没有匹配的设置",
  );
  await page
    .locator(".settings-nav nav")
    .getByRole("button", { name: "外观", exact: true })
    .click();
  await page.getByRole("button", { name: "切换主题", exact: true }).click();
  await page
    .getByRole("menuitemradio", { name: "深色主题", exact: true })
    .click();
  await page.setViewportSize({ width: 900, height: 760 });
  await page.screenshot({ path: info.outputPath("rc1-settings-dark-900.png") });
  const bounds = await page
    .locator(".settings-content")
    .evaluate((e) => ({ width: e.clientWidth, scroll: e.scrollWidth }));
  expect(bounds.scroll).toBeLessThanOrEqual(bounds.width);
  await page.getByRole("button", { name: "返回知识库", exact: true }).click();
  await expect(page.locator(".live-editor")).toContainText("设置前的编辑内容");
  await page
    .locator(".history-capsule")
    .getByRole("button", { name: "撤销", exact: true })
    .click();
  await expect(page.locator(".live-editor")).toContainText("正文");
});

test("filter retains keyboard focus and resets selection without affecting hidden notes", async ({
  page,
}) => {
  await page.locator(".document-card").first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "多选", exact: true }).click();
  const filter = page.locator(".inline-search input");
  await filter.pressSequentially("B笔记");
  await expect(filter).toBeFocused();
  await expect(filter).toHaveValue("B笔记");
  await expect(page.locator(".document-card")).toHaveCount(1);
  await expect(page.locator(".batch-bar")).toHaveCount(0);
  await filter.fill("");
  await expect(page.locator(".document-card")).toHaveCount(3);
});
