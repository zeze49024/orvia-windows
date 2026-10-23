import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
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
      newDocument(data.libraries[0].id, "A笔记", "# 原始正文 A"),
      newDocument(data.libraries[0].id, "B笔记", "原始正文 B"),
    ];
    data.documents.forEach((d: { starred: boolean }) => {
      d.starred = true;
    });
    data.documents[0].pinned = true;
    data.documents[0].tags = ["保留标签"];
    store.change(() => data);
    await store.flush();
  });
});

test("right-click single move works across document lists, cancellation preserves notes, confirmation persists only the target", async ({
  page,
}, info) => {
  for (const name of ["全部文档", "最近打开", "星标文档", "工作笔记"]) {
    await page
      .locator(".sidebar .nav-row")
      .filter({ hasText: name })
      .first()
      .click();
    await page
      .locator(".document-card")
      .filter({ hasText: "A笔记" })
      .click({ button: "right" });
    await expect(
      page.getByRole("menuitem", { name: "移动到", exact: true }),
    ).toBeVisible();
    if (name === "工作笔记")
      await page.screenshot({ path: info.outputPath("rc3-context-menu.png") });
    await page.getByRole("menuitem", { name: "移动到", exact: true }).click();
    await expect(page.locator(".batch-bar")).toHaveCount(0);
    await expect(page.getByRole("dialog")).toContainText("A笔记");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "归档资料", exact: true })
      .click();
    await expect(page.getByRole("alertdialog")).toContainText("A笔记");
    await expect(page.getByRole("alertdialog")).not.toContainText("B笔记");
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "取消", exact: true })
      .click();
    await page.keyboard.press("Escape");
    await expect(page.locator(".document-card")).toHaveCount(2);
  }
  await page
    .locator(".document-card")
    .filter({ hasText: "A笔记" })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "移动到", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "归档资料", exact: true })
    .click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "确认", exact: true })
    .click();
  await expect(page.locator(".document-card")).toHaveCount(1);
  await expect(page.locator(".document-card")).toContainText("B笔记");
  await page
    .locator(".sidebar .nav-row")
    .filter({ hasText: "归档资料" })
    .click();
  await expect(page.locator(".document-card")).toHaveCount(1);
  await expect(page.locator(".document-card")).toContainText("保留标签");
  await expect(page.locator(".favorite-button")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator(".card-main h3 .lucide-pin")).toHaveCount(1);
  await page.locator(".card-main").click();
  await page.keyboard.press("Control+s");
  await expect(page.locator(".editor-save")).toContainText("已保存");
  await page.reload();
  await page
    .locator(".sidebar .nav-row")
    .filter({ hasText: "归档资料" })
    .click();
  await page.locator(".card-main").click();
  await expect(page.locator(".live-editor")).toContainText("原始正文 A");
});

test("right-click targets only that note while multiselect remains separate; export uses a neutral label and offers both formats", async ({
  page,
}) => {
  await page
    .locator(".document-card")
    .filter({ hasText: "B笔记" })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "多选", exact: true }).click();
  await page
    .locator(".document-card")
    .filter({ hasText: "A笔记" })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "移动到", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "归档资料", exact: true })
    .click();
  await expect(page.getByRole("alertdialog")).not.toContainText("B笔记");
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "确认", exact: true })
    .click();
  await expect(page.locator(".card-selected")).toHaveCount(1);
  await expect(page.locator(".card-selected")).toContainText("B笔记");
  await page
    .locator(".batch-capsule")
    .getByRole("button", { name: "导出", exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button", { name: "独立 .md 文件", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button", { name: "ZIP 压缩包", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page
    .locator(".sidebar .nav-row")
    .filter({ hasText: "工作笔记" })
    .click();
  await expect(page.locator(".document-card")).toHaveCount(1);
  await expect(page.locator(".document-card")).toContainText("B笔记");
});
