import { test, expect } from "@playwright/test";
test("write, format, manage, recover, export, import and retain theme across reload", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .locator(".page-actions")
    .getByRole("button", { name: "新建文档", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("input").fill("Beta6 验收");
  await dialog.getByRole("button", { name: "创建文档", exact: true }).click();
  const body = page.getByRole("textbox", {
    name: "Markdown 正文",
    exact: true,
  });
  await body.fill("原始内容");
  const favorite = page.locator(".editor-toolbar .favorite-button");
  await expect(favorite).toHaveAttribute("aria-pressed", "false");
  await favorite.click();
  await expect(favorite).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Control+s");
  await expect(page.locator(".editor-save")).toContainText("已保存");
  await body.fill("修改后的内容");
  await page.keyboard.press("Control+s");
  await expect(page.locator(".editor-save")).toContainText("已保存");
  await page.getByRole("button", { name: "文档选项", exact: true }).click();
  await expect(dialog.getByText("历史版本", { exact: true })).toBeVisible();
  await dialog
    .getByRole("textbox", { name: "标签", exact: true })
    .fill("设计, 验收");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".doc-meta")).toContainText("验收");
  await page.getByRole("button", { name: "文档选项", exact: true }).click();
  await dialog.locator(".history-list button").first().click();
  await dialog.getByRole("button", { name: "恢复此版本", exact: true }).click();
  // First automatic checkpoint may be the empty initial note; restoring creates another reversible checkpoint.
  await page.getByRole("button", { name: "文档选项", exact: true }).click();
  await dialog.locator(".history-list button").first().click();
  await expect(dialog.locator(".history-preview")).toHaveText("修改后的内容");
  await dialog.getByRole("button", { name: "恢复此版本", exact: true }).click();
  await expect(body).toContainText("修改后的内容");
  await page.getByRole("button", { name: "切换主题", exact: true }).click();
  await page
    .getByRole("menuitemradio", { name: "深色主题", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.keyboard.press("Control+s");
  await expect(page.locator(".editor-save")).toContainText("已保存");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.locator(".card-main").filter({ hasText: "Beta6 验收" }).click();
  await expect(
    page.locator(".editor-toolbar .favorite-button"),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("textbox", { name: "Markdown 正文", exact: true }),
  ).toContainText("修改后的内容");
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "导出 Markdown", exact: true })
    .click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("Beta6 验收.md");
  await expect(page.locator(".document-aside")).not.toContainText("文档信息");
});
test("all headings, source navigation, sticky toolbar and undo preserve editing flow", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .locator(".page-actions")
    .getByRole("button", { name: "新建文档", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("input").fill("标题导航");
  await dialog.getByRole("button", { name: "创建文档", exact: true }).click();
  const body = page.getByRole("textbox", {
    name: "Markdown 正文",
    exact: true,
  });
  await body.fill("中文输入与撤销");
  await body.press("End");
  await body.press("Control+a");
  await page.getByRole("button", { name: "标题", exact: true }).click();
  await page
    .getByRole("menuitemradio", { name: "标题 1 H1", exact: true })
    .click();
  await expect(page.locator(".live-editor h1")).toHaveText("中文输入与撤销");
  for (let level = 2; level <= 6; level++) {
    // Select the actual heading line, rather than the blank trailing paragraph
    // that ProseMirror maintains after block nodes.
    await page
      .locator(".live-editor")
      .getByText("中文输入与撤销", { exact: true })
      .click();
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
    await page.getByRole("button", { name: "标题", exact: true }).click();
    await page
      .getByRole("menuitemradio", {
        name: `标题 ${level} H${level}`,
        exact: true,
      })
      .click();
    await expect(
      page
        .locator(`.live-editor h${level}`)
        .filter({ hasText: "中文输入与撤销" }),
    ).toHaveText("中文输入与撤销");
  }
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(
    page.locator(".live-editor h5").filter({ hasText: "中文输入与撤销" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await expect(
    page.locator(".live-editor h6").filter({ hasText: "中文输入与撤销" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Markdown 源码", exact: true })
    .click();
  await page
    .locator(".source-editor")
    .fill(
      "# 开头\n\n" +
        "正文很长，用于验证固定工具栏和精确导航。\n\n".repeat(120) +
        "###### 最后一个标题\n\n结尾",
    );
  await page.getByRole("button", { name: "最后一个标题", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "最后一个标题", exact: true }),
  ).toHaveAttribute("aria-current", "true");
  await expect(
    page.getByRole("toolbar", { name: "文档格式" }),
  ).toBeInViewport();
});

test("embedded images render after real file import, export and reimport", async ({
  page,
}) => {
  await page.goto("/");
  const png =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG3sAAAAASUVORK5CYII=";
  const bytes = Buffer.from(
    `# 图文往返\n\n![本地图片](data:image/png;base64,${png})`,
  );
  await page.getByRole("button", { name: "导入文档", exact: true }).click();
  const chooser = page.waitForEvent("filechooser");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "选择本地文件", exact: true })
    .click();
  await (
    await chooser
  ).setFiles({ name: "图文.md", mimeType: "text/markdown", buffer: bytes });
  const image = page.locator(".editor-image img");
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute("src", /^blob:/);
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "导出 Markdown", exact: true })
    .click();
  const download = await pending;
  const path = await download.path();
  const fs = await import("node:fs/promises");
  const exported = await fs.readFile(path!);
  expect(exported.toString()).toContain(`data:image/png;base64,${png}`);
  await page.getByRole("button", { name: "返回", exact: true }).click();
  await page.getByRole("button", { name: "导入文档", exact: true }).click();
  const second = page.waitForEvent("filechooser");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "选择本地文件", exact: true })
    .click();
  await (
    await second
  ).setFiles({ name: "往返.md", mimeType: "text/markdown", buffer: exported });
  await expect(page.locator(".editor-image img")).toHaveAttribute(
    "src",
    /^blob:/,
  );
});
