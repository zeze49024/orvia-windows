import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
async function create(page: Page, title: string, body = "") {
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
  if (body) {
    await page
      .getByRole("button", { name: "Markdown 源码", exact: true })
      .click();
    await page.locator(".source-editor").fill(body);
    await page.getByRole("button", { name: "实时编辑", exact: true }).click();
  }
}
test("rich find highlights across marks, replaces literally and undoes a batch", async ({
  page,
}) => {
  await create(page, "查找替换", "**保留** 中**文** 中文 中文 Orvia ORVIA");
  await page.keyboard.press("Control+h");
  await page
    .getByRole("textbox", { name: "查找内容", exact: true })
    .fill("中文");
  await expect(page.locator(".find-count")).toHaveText("1 / 3");
  await expect(page.locator(".find-match")).toHaveCount(4);
  await page.getByRole("button", { name: "下一个匹配", exact: true }).click();
  await expect(page.locator(".find-count")).toHaveText("2 / 3");
  await page.getByRole("textbox", { name: "替换为", exact: true }).fill("$1");
  await page
    .locator(".find-bar")
    .getByRole("button", { name: "替换", exact: true })
    .last()
    .click();
  await expect(page.locator(".live-editor")).toContainText("中文 $1 中文");
  await page.getByRole("button", { name: "全部替换", exact: true }).click();
  await expect(page.locator(".live-editor")).toContainText("保留 $1 $1 $1");
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(page.locator(".live-editor")).toContainText("中文 $1 中文");
  await expect(page.locator(".live-editor strong").first()).toHaveText("保留");
  await page
    .getByRole("textbox", { name: "查找内容", exact: true })
    .fill("orvia");
  await expect(page.locator(".find-count")).toHaveText("1 / 2");
  await page.getByRole("button", { name: "区分大小写", exact: true }).click();
  await expect(page.locator(".find-count")).toHaveText("没有匹配项");
  await page
    .getByRole("textbox", { name: "查找内容", exact: true })
    .press("Escape");
  await expect(page.locator(".find-bar")).toHaveCount(0);
});
test("source replacement preserves unsupported syntax and restores selected caret on restart", async ({
  page,
}) => {
  await create(page, "源码替换");
  await page
    .getByRole("button", { name: "Markdown 源码", exact: true })
    .click();
  const source = page.locator(".source-editor");
  const original = "<!-- 注释保留 -->\n[a].* 中文 [a].* 中文";
  await source.fill(original);
  await page.keyboard.press("Control+h");
  await page
    .getByRole("textbox", { name: "查找内容", exact: true })
    .fill("[a].*");
  await page.getByRole("textbox", { name: "替换为", exact: true }).fill("$&");
  await page.getByRole("button", { name: "全部替换", exact: true }).click();
  await expect(source).toHaveValue("<!-- 注释保留 -->\n$& 中文 $& 中文");
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(source).toHaveValue(original);
  await page.getByRole("button", { name: "关闭查找", exact: true }).click();
  await source.focus();
  await source.evaluate((el: HTMLTextAreaElement) => {
    el.setSelectionRange(19, 21);
    el.dispatchEvent(new Event("select", { bubbles: true }));
  });
  await page.waitForTimeout(180);
  await page.keyboard.press("Control+s");
  await page
    .locator(".editor-toolbar")
    .getByRole("button", { name: "返回", exact: true })
    .click();
  await page.locator(".card-main").filter({ hasText: "源码替换" }).click();
  await expect(source).toBeVisible();
  await expect
    .poll(() =>
      source.evaluate((el: HTMLTextAreaElement) => [
        el.selectionStart,
        el.selectionEnd,
      ]),
    )
    .toEqual([19, 21]);
  await page.reload();
  await page.locator(".card-main").filter({ hasText: "源码替换" }).click();
  await expect
    .poll(() =>
      source.evaluate((el: HTMLTextAreaElement) => [
        el.selectionStart,
        el.selectionEnd,
      ]),
    )
    .toEqual([19, 21]);
});
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
async function sendImage(
  page: Page,
  type: "paste" | "drop",
  name = "截图.png",
  content = png,
) {
  await page.locator(".live-editor").evaluate(
    (el, { type, name, content }) => {
      const data = new DataTransfer();
      data.items.add(
        new File(
          [Uint8Array.from(atob(content), (c) => c.charCodeAt(0))],
          name,
          { type: "image/png" },
        ),
      );
      el.dispatchEvent(
        type === "paste"
          ? new ClipboardEvent("paste", {
              clipboardData: data,
              bubbles: true,
              cancelable: true,
            })
          : new DragEvent("drop", {
              dataTransfer: data,
              bubbles: true,
              cancelable: true,
              clientX: el.getBoundingClientRect().left + 20,
              clientY: el.getBoundingClientRect().top + 20,
            }),
      );
    },
    { type, name, content },
  );
}
test("local image paste and drop support preview, alt, width, persistence and portable export", async ({
  page,
}) => {
  await create(page, "图片操作", "图片前的文字");
  await page.locator(".live-editor").focus();
  await page.keyboard.press("Control+End");
  await sendImage(page, "paste");
  await expect(page.locator(".editor-image img")).toHaveCount(1);
  await page.getByRole("button", { name: "图片设置", exact: true }).click();
  await page
    .getByRole("textbox", { name: "替代文字", exact: true })
    .fill("我的 [截图] 中文");
  await page
    .getByRole("combobox", { name: "显示宽度", exact: true })
    .selectOption("50");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "保存", exact: true })
    .click();
  await expect(page.locator(".editor-image")).toHaveAttribute(
    "style",
    /width: 50%/,
  );
  await page.getByRole("button", { name: "预览图片", exact: true }).click();
  await expect(page.getByRole("dialog").locator("img")).toHaveAttribute(
    "alt",
    "我的 [截图] 中文",
  );
  await page.keyboard.press("Escape");
  await sendImage(page, "drop", "拖入.png");
  await expect(page.locator(".editor-image img")).toHaveCount(2);
  await sendImage(page, "paste", "伪造.png", btoa("not an image"));
  await expect(page.locator(".editor-image img")).toHaveCount(2);
  await page.keyboard.press("Control+s");
  await page.reload();
  await page.locator(".card-main").filter({ hasText: "图片操作" }).click();
  await expect(page.locator(".editor-image img")).toHaveCount(2);
  await expect(
    page
      .locator(".editor-image")
      .filter({ has: page.locator('img[alt="我的 [截图] 中文"]') }),
  ).toHaveAttribute("style", /width: 50%/);
  const download = page.waitForEvent("download");
  await page
    .locator(".editor-toolbar")
    .getByRole("button", { name: "导出 Markdown", exact: true })
    .click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("图片操作.md");
  const md = await fs.readFile((await file.path())!, "utf8");
  expect(md).toContain("data:image/png;base64,");
  expect(md).toContain("orvia-width:50%");
  expect(md).toContain("我的 \\[截图\\] 中文");
});
test("rich caret and scroll survive settings, note navigation and restart", async ({
  page,
}) => {
  const text = Array.from(
    { length: 100 },
    (_, i) => `第${i}段 这是用于恢复编辑位置的正文内容。`,
  ).join("\n\n");
  await create(page, "位置恢复", text);
  const target = page.locator(".live-editor p").nth(40);
  await target.click();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  const layout = page.locator(".editor-layout");
  await layout.evaluate((el) => {
    el.scrollTop = 1800;
  });
  await page.waitForTimeout(180);
  const before = await layout.evaluate((el) => el.scrollTop);
  expect(before).toBeGreaterThan(1000);
  await page.keyboard.press("Control+,");
  await page.getByRole("button", { name: "返回知识库", exact: true }).click();
  await expect.poll(() => layout.evaluate((el) => el.scrollTop)).toBe(before);
  await page.keyboard.press("Control+s");
  await page
    .locator(".editor-toolbar")
    .getByRole("button", { name: "返回", exact: true })
    .click();
  await page.locator(".card-main").filter({ hasText: "位置恢复" }).click();
  await expect.poll(() => layout.evaluate((el) => el.scrollTop)).toBe(before);
  await page.reload();
  await page.locator(".card-main").filter({ hasText: "位置恢复" }).click();
  await expect.poll(() => layout.evaluate((el) => el.scrollTop)).toBe(before);
  await page.locator(".live-editor").focus();
  await page.keyboard.insertText("[恢复]");
  await expect(target).toContainText("第4[恢复]0段");
});
