import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
async function create(page: Page, title: string, body: string) {
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
  await page.locator(".live-editor").fill(body);
  await page.keyboard.press("Control+s");
  // Finish the baseline transaction before injecting a disk failure. The UI
  // may still briefly show the preceding saved state on a busy CI runner.
  await page.evaluate(async () => {
    const p = "/src/core/storage.ts";
    const { store } = await import(p);
    await store.flush();
  });
  await expect(page.locator(".editor-save")).toContainText("已保存");
}
async function failWrites(page: Page) {
  await page.evaluate(() => {
    const old = IDBDatabase.prototype.transaction;
    (window as any).restoreWrites = () => {
      IDBDatabase.prototype.transaction = old;
    };
    IDBDatabase.prototype.transaction = function (names, mode, options) {
      if (
        mode === "readwrite" &&
        Array.from(typeof names === "string" ? [names] : names).includes(
          "documents",
        )
      )
        throw new Error("DISK_FULL");
      return old.call(this, names, mode, options);
    };
  });
}
test("failed save reports real status, preserves content and retries without losing writing", async ({
  page,
}) => {
  await create(page, "失败重试", "已保存正文");
  await failWrites(page);
  await page.locator(".live-editor").fill("失败后保留的中文草稿");
  await expect(page.locator(".save-error")).toContainText("最近草稿已单独保护");
  await expect(page.locator(".editor-save")).toContainText("保存失败");
  await page.evaluate(() => (window as any).restoreWrites());
  await page
    .locator(".save-error")
    .getByRole("button", { name: "重试保存", exact: true })
    .click();
  await expect(page.locator(".save-error")).toHaveCount(0);
  await page.reload();
  await page.locator(".card-main").filter({ hasText: "失败重试" }).click();
  await expect(page.locator(".live-editor")).toHaveText("失败后保留的中文草稿");
  await expect(page.locator(".recovery-notice")).toHaveCount(0);
});
test("restart offers a preview, deferring preserves drafts and recovery creates a separate copy", async ({
  page,
}) => {
  await create(page, "恢复案例", "已保存正文");
  await failWrites(page);
  await page.locator(".live-editor").fill("异常退出前的中文草稿");
  await expect(page.locator(".save-error")).toContainText("最近草稿已单独保护");
  await page.reload();
  await expect(page.locator(".recovery-notice")).toContainText(
    "发现上次未保存的草稿",
  );
  await page.getByRole("button", { name: "查看恢复草稿", exact: true }).click();
  await page.getByRole("dialog").locator("summary").click();
  await expect(page.getByRole("dialog").locator("pre")).toContainText(
    "异常退出前的中文草稿",
  );
  await page.getByRole("button", { name: "稍后处理", exact: true }).click();
  await page.locator(".card-main").filter({ hasText: "恢复案例" }).click();
  await expect(page.locator(".live-editor")).toHaveText("已保存正文");
  await page.keyboard.press("Control+s");
  await page.reload();
  await expect(page.locator(".recovery-notice")).toBeVisible();
  await page.getByRole("button", { name: "查看恢复草稿", exact: true }).click();
  await page.getByRole("button", { name: "恢复为副本", exact: true }).click();
  await expect(page.locator(".live-editor")).toHaveText("异常退出前的中文草稿");
  await expect(
    page.getByRole("textbox", { name: "文档标题", exact: true }),
  ).toHaveValue("恢复案例（恢复副本）");
  await page
    .locator(".editor-toolbar")
    .getByRole("button", { name: "返回", exact: true })
    .click();
  await expect(page.locator(".document-card")).toHaveCount(2);
  await page
    .locator(".card-main")
    .filter({
      has: page.getByRole("heading", { name: "恢复案例", exact: true }),
    })
    .click();
  await expect(page.locator(".live-editor")).toHaveText("已保存正文");
});
test("PDF print layout preserves Chinese headings, table and local image with multi-page output", async ({
  page,
}) => {
  await create(page, "PDF 排版验收", "正文");
  await page
    .getByRole("button", { name: "Markdown 源码", exact: true })
    .click();
  await page
    .locator(".source-editor")
    .fill(
      "# 中文标题\n\n- 项目甲\n- 项目乙\n\n| 名称 | 数量 |\n| --- | --- |\n| 本地图片 | 1 |\n\n" +
        Array.from(
          { length: 60 },
          (_, i) => `第 ${i} 段：中文 PDF 分页验证，保留完整文字。`,
        ).join("\n\n"),
    );
  await page.getByRole("button", { name: "实时编辑", exact: true }).click();
  const png = (await fs.readFile("src-tauri/icons/icon.png")).toString(
    "base64",
  );
  await page.locator(".live-editor").focus();
  await page.keyboard.press("Control+End");
  await page.locator(".live-editor").evaluate((el, png) => {
    const data = new DataTransfer();
    data.items.add(
      new File(
        [Uint8Array.from(atob(png), (c) => c.charCodeAt(0))],
        "logo.png",
        { type: "image/png" },
      ),
    );
    el.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, png);
  await expect(page.locator(".editor-image img")).toHaveCount(1);
  await page.keyboard.press("Control+s");
  await expect(page.locator(".editor-save")).toContainText("已保存");
  await page.evaluate(() => {
    window.print = () => {};
  });
  await page.getByRole("button", { name: "导出 PDF", exact: true }).click();
  const print = page.locator(".pdf-export-root");
  await expect(print.locator("h1").first()).toHaveText("PDF 排版验收");
  await expect(print.locator("table")).toHaveCount(1);
  await expect(print.locator("img")).toHaveCount(1);
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".app-shell")).toBeHidden();
  await fs.mkdir("tmp/pdfs", { recursive: true });
  const bytes = await page.pdf({
    path: "tmp/pdfs/browser-beta2.pdf",
    format: "A4",
    printBackground: true,
  });
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  expect(
    bytes.toString("latin1").match(/\/Type \/Page\b/g)!.length,
  ).toBeGreaterThan(1);
  expect(bytes.toString("latin1")).toContain("/Subtype /Image");
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
});

test("discarding recovery requires confirmation and never removes saved notes", async ({
  page,
}) => {
  await create(page, "丢弃测试", "保留原文");
  await failWrites(page);
  await page.locator(".live-editor").fill("可丢弃的草稿");
  await expect(page.locator(".save-error")).toContainText("最近草稿已单独保护");
  await page.reload();
  await page.getByRole("button", { name: "查看恢复草稿", exact: true }).click();
  await page.getByRole("button", { name: "丢弃草稿", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "丢弃草稿", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "确认", exact: true })
    .click();
  await expect(page.locator(".recovery-notice")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".recovery-notice")).toHaveCount(0);
  await page.locator(".card-main").filter({ hasText: "丢弃测试" }).click();
  await expect(page.locator(".live-editor")).toHaveText("保留原文");
});
