import { test, expect, type Page } from "@playwright/test";
async function setup(page: Page) {
  await page.route("**/src/core/ai-transport.ts", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `export const aiAvailable=true;let config={enabled:false,provider:'deepseek',model:'deepseek-flash',maxOutputTokens:2048,maxInputChars:32000,maxRounds:3},hasKey=false,authorized=false;window.aiTest={requests:[],cancelled:[],mode:'normal'};export const aiTransport={load:async()=>({config:{...config},hasKey,authorized}),save:async(c)=>{config={...c}},saveKey:async()=>{hasKey=true;authorized=true},authorize:async()=>{authorized=true},revokeAuthorization:async()=>{authorized=false},deleteKey:async()=>{hasKey=false;authorized=false},models:async()=>['deepseek-flash'],cancel:async(id)=>{window.aiTest.cancelled.push(id)},run:async(request)=>{window.aiTest.requests.push(request);if(window.aiTest.mode==='slow')await new Promise(r=>setTimeout(r,1500));const proposal=request.mode==='edit'&&/润色|精简|扩写|翻译/.test(request.task)?{title:request.snapshot.title,body:window.aiTest.mode==='image'?'![bad](asset:'+'b'.repeat(64)+')':request.snapshot.body.replace('Original','Improved')}:null;return {answer:window.aiTest.mode==='plain'?'## Result\\n\\nSafe answer':'## Summary\\n\\n**Safe answer** <img src="https://example.invalid/track">',proposal,inputTokens:100,outputTokens:50,requests:2,actions:request.scope==='none'?[]:['read_current_note',...(proposal?['propose_note_edit']:[])]}}};`,
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
        newDocument(
          w.libraries[0].id,
          "AI fixture",
          "Original body\n\nOutside text",
        ),
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

async function send(page: Page, text?: string) {
  if (text)
    await page.getByRole("textbox", { name: "发送给 AI 的消息" }).fill(text);
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
async function sourceSelection(page: Page) {
  await page.getByRole("button", { name: "关闭 AI 面板", exact: true }).click();
  await page
    .getByRole("button", { name: "Markdown 源码", exact: true })
    .click();
  const source = page.locator(".source-editor");
  await source.evaluate((el: HTMLTextAreaElement) => {
    el.focus();
    el.setSelectionRange(0, 8);
  });
  await source.dispatchEvent("contextmenu", { clientX: 500, clientY: 420 });
  await page.getByRole("menuitem", { name: "润色", exact: true }).click();
}
test("one-time authorized side panel sends directly with safe Markdown and persistent local sessions", async ({
  page,
}) => {
  await setup(page);
  await expect(page.getByRole("region", { name: "AI 笔记助手" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "总结这篇笔记", exact: true }).click();
  expect(
    await page.evaluate(() => (window as any).aiTest.requests.length),
  ).toBe(0);
  await send(page);
  await expect(page.locator(".ai-answer h2")).toHaveText("Summary");
  await expect(page.locator(".ai-answer strong")).toHaveText("Safe answer");
  await expect(page.locator(".ai-answer img")).toHaveCount(0);
  await send(page, "继续解释这个观点");
  await expect(page.locator(".ai-assistant")).toHaveCount(2);
  const requests = await page.evaluate(() => (window as any).aiTest.requests);
  expect(requests[1].history).toHaveLength(2);
  expect(requests[1].history[0].role).toBe("user");
  await page.getByRole("button", { name: "对话记录", exact: true }).click();
  const row = page.locator(".ai-session").first();
  await row.hover();
  await row.getByRole("button", { name: /重命名对话/ }).click();
  await page
    .getByRole("textbox", { name: "对话名称", exact: true })
    .fill("我的连续对话");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await page.reload();
  await page.locator(".card-main").filter({ hasText: "AI fixture" }).click();
  await page.getByRole("button", { name: "AI 笔记助手", exact: true }).click();
  await expect(page.locator(".ai-chat-title")).toContainText("我的连续对话");
  await expect(page.locator(".ai-assistant")).toHaveCount(2);
  await page.screenshot({ path: "test-results/ai-beta5-panel.png" });
  await page.evaluate(async () => {
    const p = "/src/core/storage.ts";
    const { store } = await import(p);
    await store.flush();
    if (JSON.stringify(store.data).includes("orvia-unit-not-real-key"))
      throw Error("key leaked");
  });
});
test("source selection sends only the fragment and replaces only that fragment after review", async ({
  page,
}) => {
  await setup(page);
  await sourceSelection(page);
  await expect(page.locator(".ai-selected-reference")).toContainText(
    "Original",
  );
  await send(page);
  await expect(page.locator(".ai-proposal")).toContainText("Improved");
  const request = await page.evaluate(() => (window as any).aiTest.requests[0]);
  expect(request.scope).toBe("selection");
  expect(request.snapshot.body).toBe("Original");
  expect(JSON.stringify(request)).not.toContain("Outside text");
  await expect(page.locator(".source-editor")).toHaveValue(
    "Original body\n\nOutside text",
  );
  await page
    .getByRole("button", { name: "查看差异与替换", exact: true })
    .click();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".source-editor")).toHaveValue(
    "Original body\n\nOutside text",
  );
  await page
    .getByRole("button", { name: "查看差异与替换", exact: true })
    .click();
  await page
    .getByRole("button", { name: "确认替换选中内容", exact: true })
    .click();
  await expect(page.locator(".source-editor")).toHaveValue(
    "Improved body\n\nOutside text",
  );
  await page.evaluate(async () => {
    const p = "/src/core/storage.ts";
    const { store, documentHistory } = await import(p);
    const d = store.data.documents[0];
    if (
      !(await documentHistory(d.id)).some(
        (h) => h.document.body === "Original body\n\nOutside text",
      )
    )
      throw Error("missing history");
  });
  await page
    .getByRole("button", { name: "移除选中文字引用", exact: true })
    .click();
  await send(page, "只问一个问题");
  await expect(page.locator(".ai-assistant")).toHaveCount(2);
  const next = await page.evaluate(() =>
    (window as any).aiTest.requests.at(-1),
  );
  expect(next.scope).toBe("none");
  expect(next.snapshot.body).toBe("");
  expect(next.snapshot.title).toBe("");
});
test("rich selection respects surrounding content and insertion uses the retained caret", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "关闭 AI 面板", exact: true }).click();
  const rich = page.locator(".live-editor");
  await rich.focus();
  await page.keyboard.press("Control+Home");
  await page.keyboard.down("Shift");
  for (let i = 0; i < 8; i++) await page.keyboard.press("ArrowRight");
  await page.keyboard.up("Shift");
  await rich.dispatchEvent("contextmenu", { clientX: 500, clientY: 420 });
  await page.getByRole("menuitem", { name: "润色", exact: true }).click();
  await send(page);
  await page
    .getByRole("button", { name: "查看差异与替换", exact: true })
    .click();
  await page
    .getByRole("button", { name: "确认替换选中内容", exact: true })
    .click();
  await expect(rich).toContainText("Improved body");
  await expect(rich).toContainText("Outside text");
  await page.getByRole("button", { name: "关闭 AI 面板", exact: true }).click();
  await rich.focus();
  await page.keyboard.press("Control+End");
  await page.getByRole("button", { name: "AI 笔记助手", exact: true }).click();
  await page.evaluate(() => {
    (window as any).aiTest.mode = "plain";
  });
  await send(page, "总结");
  await expect(page.locator(".ai-assistant")).toHaveCount(2);
  await page
    .getByRole("button", { name: "插入到光标处", exact: true })
    .last()
    .click();
  await page.getByRole("button", { name: "确认插入内容", exact: true }).click();
  await expect(rich).toContainText("Safe answer");
  await expect(rich).toContainText("Outside text");
});
test("stale responses, changed proposals and image substitutions are refused; close stops late results", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    (window as any).aiTest.mode = "slow";
  });
  await send(page, "润色这些文字");
  await expect
    .poll(() => page.evaluate(() => (window as any).aiTest.requests.length))
    .toBe(1);
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
  await expect(page.locator(".ai-chat-error")).toContainText("未覆盖新内容");
  await page.evaluate(() => {
    (window as any).aiTest.mode = "image";
  });
  await send(page, "润色这些文字");
  await expect(page.locator(".ai-chat-error")).toContainText("图片引用");
  await page.evaluate(() => {
    (window as any).aiTest.mode = "slow";
  });
  await send(page, "润色这些文字");
  await expect
    .poll(() => page.evaluate(() => (window as any).aiTest.requests.length))
    .toBe(3);
  await page.getByRole("button", { name: "关闭 AI 面板", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).aiTest.cancelled.length))
    .toBe(1);
  await page.waitForTimeout(1600);
  await expect(page.locator(".live-editor")).toContainText(
    "Concurrent user writing",
  );
});

test("revoking key permission disables sending until setup reauthorization", async ({
  page,
}) => {
  await setup(page);
  await send(page, "总结");
  await expect(page.locator(".ai-assistant")).toHaveCount(1);
  await page.keyboard.press("Control+,");
  await page.getByRole("button", { name: "AI 与模型", exact: true }).click();
  await page.getByRole("button", { name: "撤销发送授权", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "确认", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "AI 笔记助手", exact: true }).click();
  await page
    .getByRole("textbox", { name: "发送给 AI 的消息" })
    .fill("不能发送");
  await expect(
    page.getByRole("button", { name: "发送消息", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Control+,");
  await page.getByRole("button", { name: "AI 与模型", exact: true }).click();
  await page
    .getByRole("button", { name: "授权后续 AI 对话", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "AI 笔记助手", exact: true }).click();
  await send(page, "重新授权后发送");
  await expect(page.locator(".ai-assistant")).toHaveCount(2);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("rapid repeated send cannot register duplicate requests", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    (window as any).aiTest.mode = "slow";
  });
  await page
    .getByRole("textbox", { name: "发送给 AI 的消息" })
    .fill("只发送一次");
  await page
    .getByRole("button", { name: "发送消息", exact: true })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
  await expect
    .poll(() => page.evaluate(() => (window as any).aiTest.requests.length))
    .toBe(1);
  await expect(page.locator(".ai-assistant")).toHaveCount(1);
  expect(
    await page.evaluate(() => (window as any).aiTest.requests.length),
  ).toBe(1);
});
