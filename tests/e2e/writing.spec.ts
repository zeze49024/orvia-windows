import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

async function create(page: Page, title: string) {
  await page.goto("/");
  await page
    .locator(".page-actions")
    .getByRole("button", { name: "新建文档", exact: true })
    .click();
  await page.getByRole("dialog").locator("input").fill(title);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "创建文档", exact: true })
    .click();
}
async function importFile(page: Page, name: string, buffer: Buffer) {
  await page.goto("/");
  await page.getByRole("button", { name: "导入文档", exact: true }).click();
  const chooser = page.waitForEvent("filechooser");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "选择本地文件", exact: true })
    .click();
  await (await chooser).setFiles({ name, mimeType: "text/markdown", buffer });
}

test("source edits undo/redo, recover unsupported syntax, and retain content after mode switch and reload", async ({
  page,
}) => {
  await create(page, "源码稳定性");
  await page
    .getByRole("button", { name: "Markdown 源码", exact: true })
    .click();
  const source = page.locator(".source-editor");
  await source.fill("中文与 emoji 😀\n\n<!-- 注释保留 -->");
  await source.press("Control+z");
  await expect(source).toHaveValue("");
  await source.press("Control+Shift+z");
  await expect(source).toHaveValue("中文与 emoji 😀\n\n<!-- 注释保留 -->");
  await page.getByRole("button", { name: "实时编辑", exact: true }).click();
  await expect(source).toBeVisible();
  await source.fill("# 中文与 emoji 😀\n\n纯正文");
  await page.getByRole("button", { name: "实时编辑", exact: true }).click();
  await expect(page.locator(".live-editor h1")).toHaveText("中文与 emoji 😀");
  await page
    .getByRole("button", { name: "Markdown 源码", exact: true })
    .click();
  await expect(source).toHaveValue("# 中文与 emoji 😀\n\n纯正文");
  await page.keyboard.press("Control+s");
  await expect(page.locator(".editor-save")).toContainText("已保存");
  await page.reload();
  await page.locator(".card-main").filter({ hasText: "源码稳定性" }).click();
  await expect(source).toHaveValue("# 中文与 emoji 😀\n\n纯正文");
  await page.getByRole("button", { name: "实时编辑", exact: true }).click();
  await expect(page.locator(".live-editor h1")).toHaveText("中文与 emoji 😀");
});

test("plain-text code paste stays literal and rich undo remains available", async ({
  page,
}) => {
  await create(page, "代码粘贴");
  await page.getByRole("button", { name: "代码块", exact: true }).click();
  const code = page.locator(".live-editor pre code");
  await page.locator(".live-editor pre").click();
  const text =
    "# not a heading\n**literal**\n![remote](https://example.invalid/a.png)\n  indent";
  await code.evaluate((el, text) => {
    const data = new DataTransfer();
    data.setData("text/plain", text);
    el.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, text);
  await expect(code).toHaveText(text);
  await expect(page.locator(".live-editor h1")).toHaveCount(0);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await expect(code).toHaveText(text);
});

test("composition events do not reset live content and commit completed Chinese text", async ({
  page,
}) => {
  await create(page, "中文组合输入");
  const body = page.locator(".live-editor");
  await body.focus();
  await body.dispatchEvent("compositionstart", { data: "" });
  // Synthetic composition verifies our event gate, not an installed OS IME.
  await body.fill("输入中的中文");
  await expect(body).toHaveText("输入中的中文");
  await body.dispatchEvent("compositionend", { data: "输入中的中文" });
  await page.keyboard.press("Control+s");
  await expect(page.locator(".editor-save")).toContainText("已保存");
  await page
    .getByRole("button", { name: "Markdown 源码", exact: true })
    .click();
  await expect(page.locator(".source-editor")).toHaveValue("输入中的中文");
});

test("UTF-16 file import preserves Unicode and unsupported Markdown exports intact", async ({
  page,
}) => {
  const original =
    "---\ntitle: 中文\n---\n\n# 标题😀\n\n正文[^1]\n\n[^1]: 脚注\n\n<!-- 保留 -->\n";
  await importFile(
    page,
    "编码.md",
    Buffer.concat([
      Buffer.from([255, 254]),
      Buffer.from(original.replaceAll("\n", "\r\n"), "utf16le"),
    ]),
  );
  await expect(page.locator(".source-editor")).toHaveValue(original);
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "导出 Markdown", exact: true })
    .click();
  const download = await pending;
  expect((await fs.readFile((await download.path())!)).toString("utf8")).toBe(
    original,
  );
});

test("selected folder resolves nested relative images and exports a single portable md", async ({
  page,
}, testInfo) => {
  const root = testInfo.outputPath("markdown-folder");
  await fs.mkdir(path.join(root, "notes"), { recursive: true });
  await fs.mkdir(path.join(root, "images"), { recursive: true });
  await fs.writeFile(
    path.join(root, "notes", "相对图片.md"),
    "# 图文\n\n![图片](../images/a%20b.png)",
  );
  const png =
    "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFUlEQVR4nGP0rrj0nwEJMCFziBMAAKj3ApyajjcEAAAAAElFTkSuQmCC";
  await fs.writeFile(
    path.join(root, "images", "a b.png"),
    Buffer.from(png, "base64"),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "导入文档", exact: true }).click();
  const chooser = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: "导入 Markdown 文件夹", exact: true })
    .click();
  await (await chooser).setFiles(root);
  await expect(page.locator(".editor-image img")).toHaveAttribute(
    "src",
    /^blob:/,
  );
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "导出 Markdown", exact: true })
    .click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe("相对图片.md");
  expect(
    (await fs.readFile((await download.path())!)).toString("utf8"),
  ).toContain(`data:image/png;base64,${png}`);
  await page.screenshot({
    path: testInfo.outputPath("beta7-folder-editor.png"),
  });
});

test("long documents open directly in source mode and export without truncation", async ({
  page,
}) => {
  const body = "# 长文\n\n" + "正文内容😀 ".repeat(30000);
  await importFile(page, "长文.md", Buffer.from(body));
  await expect(page.locator(".source-editor")).toHaveValue(body);
  await expect(page.locator(".editor-notice")).toContainText("长文档");
  await page.locator(".source-editor").press("Control+End");
  await page.locator(".source-editor").pressSequentially("END");
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "导出 Markdown", exact: true })
    .click();
  const download = await pending;
  expect((await fs.readFile((await download.path())!)).toString("utf8")).toBe(
    body + "END",
  );
});
