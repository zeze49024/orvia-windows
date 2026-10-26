import { test, expect, type Page } from "@playwright/test";
for(const locale of ['en','zh-TW'] as const)test(`locked vault retains ${locale} after restart`,async({page})=>{
 await page.goto('/');await page.locator('.app-shell').waitFor();
 await page.evaluate(async(locale)=>{const modulePath='/src/core/storage.ts';const {store}=await import(modulePath);store.change(s=>({...s,settings:{...s.settings,locale}}));await store.flush();await store.createVault('language regression passphrase');await store.lockVault()},locale);
 await page.reload();await expect(page.locator('.vault-gate')).toBeVisible();await expect(page.getByRole('button',{name:locale==='en'?'Unlock':'解鎖',exact:true})).toBeVisible();
});
async function settings(page: Page) {
  await page.getByRole("button", { name: /^设置 Ctrl/ }).click();
}
test("templates, advanced search, shortcut validation and preview channel consent", async ({
  page,
}) => {
  await page.goto("/");
  await settings(page);
  await page.getByRole("button", { name: "模板与快捷键", exact: true }).click();
  await page
    .getByRole("textbox", { name: "模板名称", exact: true })
    .fill("Project template");
  await page
    .getByRole("textbox", { name: "模板 Markdown", exact: true })
    .fill("## Project\n\nneedle 中文");
  await page.getByRole("button", { name: "保存模板", exact: true }).click();
  await page
    .getByRole("textbox", { name: "全局搜索", exact: true })
    .fill("Ctrl+N");
  await page.getByRole("button", { name: "保存快捷键", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("冲突");
  await page.getByRole("button", { name: "恢复默认", exact: true }).click();
  await page.getByRole("button", { name: "返回知识库", exact: true }).click();
  await page
    .locator(".page-actions")
    .getByRole("button", { name: "新建文档", exact: true })
    .click();
  await page.getByRole("dialog").locator("input").fill("Project");
  await page
    .getByRole("dialog")
    .locator("select")
    .first()
    .selectOption({ label: "Project template" });
  await page.getByRole("button", { name: "创建文档", exact: true }).click();
  await expect(page.locator(".live-editor")).toContainText("needle 中文");
  await page.keyboard.press("Control+k");
  await page.getByRole("textbox", { name: "搜索", exact: true }).fill("needle");
  await expect(page.locator(".search-results")).toContainText("Project");
  await page.getByRole("combobox", { name: "搜索范围" }).selectOption("title");
  await expect(
    page.getByRole("status").filter({ hasText: "0 篇笔记" }),
  ).toBeVisible();
  await page.getByRole("combobox", { name: "搜索范围" }).selectOption("body");
  await page.locator(".search-results button").click();
  await expect(page.locator(".find-bar")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.screenshot({ path: "test-results/beta3-search.png" });
  await settings(page);
  await page.getByRole("button", { name: "版本与更新", exact: true }).click();
  await page
    .getByRole("combobox", { name: "更新通道", exact: true })
    .selectOption("preview");
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "更新通道", exact: true }),
  ).toHaveValue("stable");
  await page
    .getByRole("combobox", { name: "更新通道", exact: true })
    .selectOption("preview");
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "确认", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "更新通道", exact: true }),
  ).toHaveValue("preview");
});
test("vault locks on demand, survives reload, prevents wrong password and keeps public notes separate", async ({
  page,
}) => {
  await page.goto("/");
  await settings(page);
  await page
    .getByRole("button", { name: "安全与加密知识库", exact: true })
    .click();
  await page
    .getByLabel("密码（至少 12 个字符）", { exact: true })
    .fill("long private passphrase");
  await page
    .getByLabel("再次输入密码", { exact: true })
    .fill("long private passphrase");
  await page.getByRole("button", { name: "创建加密空间", exact: true }).click();
  await expect(page.locator(".vault-gate")).toHaveCount(0);
  await page
    .locator(".page-actions")
    .getByRole("button", { name: "新建文档", exact: true })
    .click();
  await page.getByRole("dialog").locator("input").fill("SECRET NOTE");
  await page.getByRole("button", { name: "创建文档", exact: true }).click();
  await page.locator(".live-editor").fill("SECRET BODY 中文");
  await page.keyboard.press("Control+s");
  await expect(page.locator(".editor-save")).toContainText("已保存");
  await page.keyboard.press("Control+Shift+l");
  await expect(page.locator(".vault-gate")).toBeVisible();
  await expect(page.getByText("SECRET NOTE", { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".vault-gate")).toBeVisible();
  await page
    .getByLabel("密码（至少 12 个字符）", { exact: true })
    .fill("wrong password");
  await page.getByRole("button", { name: "解锁", exact: true }).click();
  await expect(page.locator(".vault-gate")).toBeVisible();
  await page
    .getByLabel("密码（至少 12 个字符）", { exact: true })
    .fill("long private passphrase");
  await page.getByRole("button", { name: "解锁", exact: true }).click();
  await expect(
    page.getByText("SECRET NOTE", { exact: true }).first(),
  ).toBeVisible();
  await settings(page);
  await page
    .getByRole("button", { name: "安全与加密知识库", exact: true })
    .click();
  await page
    .getByRole("button", { name: "打开普通知识库", exact: true })
    .click();
  await expect(page.getByText("SECRET NOTE", { exact: true })).toHaveCount(0);
});
