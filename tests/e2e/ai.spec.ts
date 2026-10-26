import { test, expect, type Page } from "@playwright/test";
async function setup(page: Page) {
  await page.route("**/src/core/ai-transport.ts", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `export const aiAvailable=true;let config={enabled:false,provider:'deepseek',model:'deepseek-flash',maxOutputTokens:2048,maxInputChars:32000,maxRounds:3},hasKey=false;window.aiTest={requests:[],cancelled:[],mode:'normal'};export const aiTransport={load:async()=>({config:{...config},hasKey}),save:async(c)=>{config={...c}},saveKey:async()=>{hasKey=true},deleteKey:async()=>{hasKey=false},models:async()=>['deepseek-flash'],cancel:async(id)=>{window.aiTest.cancelled.push(id)},run:async(request)=>{window.aiTest.requests.push(request);if(window.aiTest.mode==='slow')await new Promise(r=>setTimeout(r,1500));const proposal=request.mode==='edit'?{title:request.snapshot.title,body:window.aiTest.mode==='image'?'![bad](asset:'+'b'.repeat(64)+')':request.snapshot.body+'\\n\\nAI improved text'}:null;return {answer:'<img src="https://example.invalid/track"> Summary of current note',proposal,inputTokens:100,outputTokens:50,requests:2,actions:['read_current_note',...(proposal?['propose_note_edit']:[])]}}};`,
    }),
  );
  await page.goto("/");
  await page.locator(".app-shell").waitFor();
  await page.evaluate(async () => {
    const m = "/src/core/model.ts",
      s = "/src/core/storage.ts";
    const { newDocument } = await import(m),
      { store } = await import(s);
    store.change((w) => ({
      ...w,
      documents: [
        newDocument(w.libraries[0].id, "AI fixture", "Original body"),
      ],
    }));
    await store.flush();
  });
  await page.keyboard.press("Control+,");
  await page.getByRole("button", { name: "AI 与模型", exact: true }).click();
  await page.getByRole("switch", { name: "启用 AI 助手" }).check();
  await page
    .getByRole("textbox", { name: "API Key", exact: true })
    .fill("orvia-unit-not-real-key");
  await page.getByRole("button", { name: "保存 Key", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "API Key", exact: true }),
  ).toHaveValue("");
  await page.getByRole("button", { name: "保存 AI 设置", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("AI 设置已保存");
  await page.keyboard.press("Escape");
  await page.locator(".card-main").filter({ hasText: "AI fixture" }).click();
  await page.getByRole("button", { name: "AI 笔记助手", exact: true }).click();
}
test("explicit consent, safe text rendering, review confirmation and durable AI history", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "总结这篇笔记", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "授权并发送", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("checkbox", { name: "我同意将当前笔记文字发送给所选服务商" })
    .check();
  await page.getByRole("button", { name: "授权并发送", exact: true }).click();
  await expect(page.locator(".ai-answer")).toContainText("<img");
  await expect(page.locator(".ai-answer img")).toHaveCount(0);
  await page
    .getByRole("button", { name: "润色并保留原意", exact: true })
    .click();
  await page.getByRole("button", { name: "授权并发送", exact: true }).click();
  await expect(page.locator(".ai-diff").first()).toContainText("AI improved text");
  await page
    .getByRole("button", { name: "确认并应用修改", exact: true })
    .click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await expect(page.locator(".live-editor")).toContainText("Original body");
  await expect(page.locator(".live-editor")).not.toContainText(
    "AI improved text",
  );
  await page
    .getByRole("button", { name: "确认并应用修改", exact: true })
    .click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "确认", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "AI 修改已保存，可从文档历史恢复原文。",
      exact: true,
    }),
  ).toBeDisabled();
  await page.screenshot({ path: "test-results/ai-review.png" });
  await page.evaluate(async () => {
    const path = "/src/core/storage.ts";
    const { store, documentHistory } = await import(path);
    if (!store.data.documents[0].body.includes("AI improved text"))
      throw new Error("Not applied");
    if (
      !(await documentHistory(store.data.documents[0].id)).some(
        (h) => h.document.body === "Original body",
      )
    )
      throw new Error("Missing durable history");
    const data = JSON.stringify(store.data);
    if (data.includes("orvia-unit-not-real-key"))
      throw new Error("Key leaked into workspace");
  });
});
test("stale responses and image references are refused; close cancels pending calls", async ({
  page,
}) => {
  await setup(page);
  await page
    .getByRole("checkbox", { name: "我同意将当前笔记文字发送给所选服务商" })
    .check();
  await page
    .getByRole("button", { name: "润色并保留原意", exact: true })
    .click();
  await page.evaluate(() => {
    (window as any).aiTest.mode = "slow";
  });
  await page.getByRole("button", { name: "授权并发送", exact: true }).click();
  await page.evaluate(async () => {
    const p = "/src/core/storage.ts";
    const { store } = await import(p);
    store.change((s) => ({
      ...s,
      documents: s.documents.map((d) => ({
        ...d,
        body: "Concurrent user writing",
      })),
    }));
    await store.flush();
  });
  await expect(page.getByRole("alert")).toContainText("未覆盖新内容");
  await page.evaluate(() => {
    (window as any).aiTest.mode = "image";
  });
  await page.getByRole("button", { name: "授权并发送", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("图片引用");
  await page.evaluate(() => {
    (window as any).aiTest.mode = "slow";
  });
  await page.getByRole("button", { name: "授权并发送", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => (window as any).aiTest.cancelled.length))
    .toBe(1);
  await page.waitForTimeout(1600);
  await expect(page.locator(".live-editor")).toContainText(
    "Concurrent user writing",
  );
});
