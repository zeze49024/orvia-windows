import { execFile } from "node:child_process";
import { promisify } from "node:util";
// Runs ONLY against a disposable CI installation with WebView2 debugging enabled.
import { chromium, expect } from "@playwright/test";
import path from "node:path";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
const phase = process.argv[2];
const previousVersion = (process.env.PREVIOUS_TAG || "v0.1.1-rc2").replace(
  /^v/,
  "",
);
const legacyStable = previousVersion === "0.1.0";
if (
  !process.env.CI ||
  !["seed", "verify", "update", "crash", "recover"].includes(phase)
)
  throw new Error("Disposable CI environment required");
let browser;
let connectionError;
for (let attempt = 0; attempt < 120; attempt++) {
  try {
    browser = await chromium.connectOverCDP("http://127.0.0.1:9226");
    break;
  } catch (error) {
    connectionError = error;
    await new Promise((r) => setTimeout(r, 500));
  }
}
if (!browser)
  throw new Error("Native WebView2 did not start", { cause: connectionError });
// WebView2 may expose its debugging server before creating the first target.
let page;
for (let attempt = 0; attempt < 80; attempt++) {
  page = browser
    .contexts()
    .flatMap((context) => context.pages())
    .find((target) => !target.isClosed());
  if (page) break;
  await new Promise((resolve) => setTimeout(resolve, 200));
}
if (!page) throw new Error("Native WebView2 did not create a page target");
await page.waitForSelector(".app-shell");
await page
  .locator(".statusbar")
  .filter({ hasText: /已保存|Saved|已儲存/ })
  .waitFor();
const invoke = (command, args) =>
  page.evaluate(
    async ({ command, args }) =>
      window.__TAURI_INTERNALS__.invoke(command, args),
    { command, args },
  );
const setupDialog = (mode) =>
  promisify(execFile)(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      "scripts/acceptance-save-dialog.ps1",
      "-Target",
      path.resolve("native-validation.json"),
      "-Mode",
      mode,
    ],
    { timeout: 50000 },
  );

if (phase === "seed") {
  const loaded = await invoke("load_workspace");
  const data = loaded.data;
  const now = new Date().toISOString();
  data.documents.push({
    id: "af485e10-f680-4ff6-8b40-af799171e221",
    libraryId: data.libraries[0].id,
    title: "Upgrade preservation",
    body: `# Native upgrade fixture\n\n中文内容 retained from ${previousVersion}`,
    tags: ["upgrade"],
    starred: true,
    createdAt: now,
    updatedAt: now,
    openedAt: null,
    deletedAt: null,
  });
  if (!legacyStable) {
    data.settings.motion = "elegant";
    data.settings.aiConversations = [
      {
        id: crypto.randomUUID(),
        documentId: "af485e10-f680-4ff6-8b40-af799171e221",
        title: "Upgrade AI conversation",
        createdAt: now,
        updatedAt: now,
        messages: [
          {
            id: crypto.randomUUID(),
            role: "user",
            content: "Synthetic conversation retained from rc2",
            createdAt: now,
            scope: "none",
          },
        ],
      },
    ];
  }
  await invoke("save_workspace", { data, expectedRevision: loaded.revision });
  if (!legacyStable) {
    const approval = setupDialog("ApproveAISetup");
    await invoke("ai_save_key", {
      provider: "deepseek",
      key: "orvia-upgrade-only-not-a-real-key",
      locale: "en",
    });
    console.log((await approval).stdout);
  }
} else if (phase === "update") {
  await page.reload();
  await page.waitForSelector(".app-shell");
  const loaded = await invoke("load_workspace");
  const strings = JSON.parse(
    await readFile(
      new URL(
        `../src/i18n/locales/${loaded.data.settings.locale}.json`,
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await page.keyboard.press("Control+,");
  await page
    .locator(".settings-nav nav")
    .getByRole("button", { name: strings.versionUpdates, exact: true })
    .click();
  const channelLabel =
    loaded.data.settings.locale === "en" ? "Update channel" : "更新通道";
  const channel = page.getByRole("combobox", {
    name: channelLabel,
    exact: true,
  });
  if (!legacyStable) {
    await channel.selectOption("preview");
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: strings.confirm, exact: true })
      .click();
  }
  await page
    .getByRole("button", { name: strings.checkUpdates, exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByText(/→ v0\.1\.1$/)
    .waitFor({ timeout: 60000 });
  const closed = page.waitForEvent("close", { timeout: 120000 });
  await page
    .getByRole("button", { name: strings.updateInstall, exact: true })
    .click();
  await closed;
} else if (phase === "crash") {
  await page.reload();
  const loaded = await invoke("load_workspace");
  const strings = JSON.parse(
    await readFile(
      new URL(
        `../src/i18n/locales/${loaded.data.settings.locale}.json`,
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const doc = loaded.data.documents.find(
    (d) => d.title === "Upgrade preservation",
  );
  await writeFile("native-crash-baseline.json", JSON.stringify(doc));
  await page.locator(".card-main").filter({ hasText: doc.title }).click();
  if (!(await page.locator(".source-editor").count()))
    await page
      .getByRole("button", { name: strings.sourceMode, exact: true })
      .click();
  await page.evaluate(() => {
    const original = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const cmd = decodeURIComponent(
        new URL(typeof input === "string" ? input : input.url).pathname.slice(
          1,
        ),
      );
      if (cmd === "save_delta")
        return Promise.resolve(
          new Response(JSON.stringify("TEST_DISK_FULL"), {
            headers: {
              "Content-Type": "application/json",
              "Tauri-Response": "error",
            },
          }),
        );
      return original(input, init);
    };
  });
  await page
    .locator(".source-editor")
    .fill(doc.body + "\n\nCRASH RECOVERY 中文草稿");
  await page.keyboard.press("Control+s");
  await expect(page.locator(".save-error")).toContainText(
    strings.draftProtected,
  );
  const journal = await invoke("read_recovery");
  if (
    !journal.documents.some(
      (d) => d.id === doc.id && d.body.includes("CRASH RECOVERY 中文草稿"),
    )
  )
    throw new Error("Draft not protected on disk");
} else if (phase === "recover") {
  const baseline = JSON.parse(
    await readFile("native-crash-baseline.json", "utf8"),
  );
  const loaded = await invoke("load_workspace");
  const strings = JSON.parse(
    await readFile(
      new URL(
        `../src/i18n/locales/${loaded.data.settings.locale}.json`,
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await page
    .getByRole("button", { name: strings.reviewDrafts, exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText(baseline.title);
  await page
    .getByRole("button", { name: strings.recoverCopies, exact: true })
    .click();
  await page.locator(".statusbar").filter({ hasText: strings.saved }).waitFor();
  const result = (await invoke("load_workspace")).data;
  if (result.documents.find((d) => d.id === baseline.id).body !== baseline.body)
    throw new Error("Recovery overwrote original");
  if (
    !result.documents.some(
      (d) => d.id !== baseline.id && d.body.includes("CRASH RECOVERY 中文草稿"),
    )
  )
    throw new Error("Crash draft not restored");
  const evidence = JSON.parse(await readFile("native-validation.json", "utf8"));
  evidence.crashRecovery = true;
  await writeFile("native-validation.json", JSON.stringify(evidence, null, 2));
} else {
  await expect(page).toHaveTitle("Orvia v0.1.1");
  await expect(page.locator(".sidebar-foot")).toContainText("v0.1.1");
  const loaded = await invoke("load_workspace");
  const doc = loaded.data.documents.find(
    (d) => d.title === "Upgrade preservation",
  );
  if (
    !doc?.body.includes(`中文内容 retained from ${previousVersion}`) ||
    !doc.starred ||
    doc.tags[0] !== "upgrade"
  )
    throw new Error("Upgrade lost data");
  if (
    !legacyStable &&
    !loaded.data.settings.aiConversations.some(
      (c) =>
        c.title === "Upgrade AI conversation" &&
        c.messages[0]?.content === "Synthetic conversation retained from rc2",
    )
  )
    throw new Error("Upgrade lost AI history");
  const changed = { ...doc, body: doc.body + "\n\nSaved by v0.1.1" };
  const delta = {
    libraries: { upsert: [], remove: [] },
    documents: { upsert: [changed], remove: [] },
    assets: { upsert: [], remove: [] },
    settings: null,
  };
  await invoke("save_delta", {
    delta,
    expectedRevision: loaded.revision,
    forceHistory: [],
  });
  const entries = await invoke("document_history", { id: doc.id });
  if (entries[0].document.body !== doc.body)
    throw new Error("Native history failed");
  await page.reload();
  await page.waitForSelector(".app-shell");
  const strings = JSON.parse(
    await readFile(
      new URL(
        `../src/i18n/locales/${loaded.data.settings.locale}.json`,
        import.meta.url,
      ),
      "utf8",
    ),
  );
  if (phase === "verify") {
    await page
      .getByRole("button", { name: strings.featureInDevelopment, exact: true })
      .click();
    await expect(page.locator(".toast span")).toHaveText(
      strings.featureInDevelopmentHint,
    );
    await expect(page.locator(".page-content")).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  await page
    .locator(".document-card")
    .filter({ hasText: "Upgrade preservation" })
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: strings.multiSelect, exact: true })
    .click();
  await page.getByRole("button", { name: strings.pin, exact: true }).click();
  await page.keyboard.press("Control+s");
  await page.locator(".statusbar").filter({ hasText: strings.saved }).waitFor();
  const pinned = (await invoke("load_workspace")).data.documents.find(
    (d) => d.id === doc.id,
  );
  if (!pinned?.pinned || !pinned.starred)
    throw new Error("Native pin/favorite persistence failed");
  await page
    .locator(".document-card")
    .filter({ hasText: "Upgrade preservation" })
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: strings.delete, exact: true })
    .click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: strings.cancel, exact: true })
    .click();
  if (
    (await invoke("load_workspace")).data.documents.find((d) => d.id === doc.id)
      ?.deletedAt
  )
    throw new Error("Delete cancellation mutated document");
  const beforeMove = await invoke("load_workspace"),
    target = { id: crypto.randomUUID(), name: "Native target", color: "green" };
  await invoke("save_delta", {
    expectedRevision: beforeMove.revision,
    forceHistory: [],
    delta: {
      libraries: { upsert: [target], remove: [] },
      documents: { upsert: [], remove: [] },
      assets: { upsert: [], remove: [] },
      settings: null,
    },
  });
  await page.reload();
  await page.waitForSelector(".app-shell");
  await page
    .locator(".document-card")
    .filter({ hasText: "Upgrade preservation" })
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: strings.moveTo, exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: target.name, exact: true })
    .click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: strings.confirm, exact: true })
    .click();
  await page.keyboard.press("Control+s");
  await page.locator(".statusbar").filter({ hasText: strings.saved }).waitFor();
  const moved = (await invoke("load_workspace")).data.documents.find(
    (d) => d.id === doc.id,
  );
  if (
    moved?.libraryId !== target.id ||
    !moved.starred ||
    !moved.pinned ||
    moved.body !== changed.body
  )
    throw new Error(
      "Single context move did not persist or changed note content",
    );
  await page
    .locator(".card-main")
    .filter({ hasText: "Upgrade preservation" })
    .click();
  if (
    !(await page.locator(".live-editor").innerText()).includes(
      "Saved by v0.1.1",
    )
  )
    throw new Error("Native editor reload failed");
  await page.keyboard.press("Control+,");
  await page
    .locator(".settings-nav nav")
    .getByRole("button", { name: strings.versionUpdates, exact: true })
    .click();
  await page
    .getByRole("button", { name: strings.checkUpdates, exact: true })
    .waitFor();
  const automatic = page.getByRole("switch", {
    name: strings.autoUpdate,
    exact: true,
  });
  if (!(await automatic.isChecked()))
    throw new Error("Automatic detection default was not migrated");
  await automatic.uncheck();
  await page.keyboard.press("Control+s");
  await page.locator(".statusbar").filter({ hasText: strings.saved }).waitFor();
  if ((await invoke("load_workspace")).data.settings.autoUpdate !== false)
    throw new Error("Automatic update opt-out did not persist");

  if (await page.getByRole("dialog").count())
    throw new Error("Settings is still a modal");
  await page
    .getByRole("button", { name: strings.backLibrary, exact: true })
    .click();
  await page.locator(".live-editor").waitFor();
  // Exercise the shipped writing tools in actual WebView2 with real native asset storage.
  await page.keyboard.press("Control+h");
  await page
    .getByRole("textbox", { name: strings.findText, exact: true })
    .fill("Native upgrade fixture");
  await expect(page.locator(".find-count")).toHaveText("1 / 1");
  await page
    .getByRole("textbox", { name: strings.replaceWith, exact: true })
    .fill("Native writing fixture");
  await page
    .getByRole("button", { name: strings.replaceAll, exact: true })
    .click();
  await expect(page.locator(".live-editor h1")).toHaveText(
    "Native writing fixture",
  );
  await page.getByRole("button", { name: strings.undo, exact: true }).click();
  await expect(page.locator(".live-editor h1")).toHaveText(
    "Native upgrade fixture",
  );
  await page
    .getByRole("button", { name: strings.closeFind, exact: true })
    .click();
  const pixel =
    "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFUlEQVR4nGP0rrj0nwEJMCFziBMAAKj3ApyajjcEAAAAAElFTkSuQmCC";
  await page.locator(".live-editor").focus();
  await page.keyboard.press("Control+End");
  for (const type of ["paste", "drop"]) {
    await page.locator(".live-editor").evaluate(
      (el, { pixel, type }) => {
        const transfer = new DataTransfer();
        transfer.items.add(
          new File(
            [Uint8Array.from(atob(pixel), (c) => c.charCodeAt(0))],
            "native.png",
            { type: "image/png" },
          ),
        );
        el.dispatchEvent(
          type === "paste"
            ? new ClipboardEvent("paste", {
                clipboardData: transfer,
                bubbles: true,
                cancelable: true,
              })
            : new DragEvent("drop", {
                dataTransfer: transfer,
                bubbles: true,
                cancelable: true,
                clientX: el.getBoundingClientRect().left + 10,
                clientY: el.getBoundingClientRect().top + 10,
              }),
        );
      },
      { pixel, type },
    );
    await expect(page.locator(".editor-image img")).toHaveCount(
      type === "paste" ? 1 : 2,
    );
    await page
      .locator(".statusbar")
      .filter({ hasText: strings.saved })
      .waitFor();
  }
  await page
    .getByRole("button", { name: strings.imageOptions, exact: true })
    .first()
    .click();
  await page
    .getByRole("textbox", { name: strings.imageAlt, exact: true })
    .fill("Native 中文 [图片]");
  await page
    .getByRole("combobox", { name: strings.imageSize, exact: true })
    .selectOption("50");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: strings.save, exact: true })
    .click();
  await page
    .getByRole("button", { name: strings.imagePreview, exact: true })
    .first()
    .click();
  await expect(page.getByRole("dialog").locator("img")).toHaveAttribute(
    "alt",
    "Native 中文 [图片]",
  );
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: strings.sourceMode, exact: true })
    .click();
  const area = page.locator(".source-editor");
  // Background WebView2 throttles frames and timers. Let initial restoration finish
  // before simulating the user's new selection, then wait for its durable preference.
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await area.focus();
  await area.evaluate((el) => {
    el.setSelectionRange(3, 5);
    el.dispatchEvent(new Event("select", { bubbles: true }));
  });
  await expect
    .poll(
      () =>
        page.evaluate((id) => {
          const saved = JSON.parse(
            localStorage.getItem("orvia-writing-positions-v1") ?? "{}",
          )[id];
          return saved ? [saved.source.from, saved.source.to] : null;
        }, doc.id),
      { timeout: 15000 },
    )
    .toEqual([3, 5]);
  await page.keyboard.press("Control+s");
  await page.locator(".statusbar").filter({ hasText: strings.saved }).waitFor();
  const written = (await invoke("load_workspace")).data.documents.find(
    (d) => d.id === doc.id,
  );
  if (
    !written.body.includes("orvia-width:50%") ||
    !written.body.includes("asset:") ||
    !written.body.includes("Native 中文")
  )
    throw new Error("Native image metadata not persisted");
  await page.reload();
  await page
    .locator(".card-main")
    .filter({ hasText: "Upgrade preservation" })
    .click();
  await expect(area).toBeVisible();
  await expect
    .poll(() => area.evaluate((el) => [el.selectionStart, el.selectionEnd]))
    .toEqual([3, 5]);
  // Hold only the save-target IPC, then exercise the real native CloseRequested
  // handler while export is busy. No real dialog, provider or user data is used.
  const exportGuardBody =
    written.body + "\n\nEXPORT EXIT SAFETY: latest unsaved paragraph";
  await area.fill(exportGuardBody);
  await page.evaluate(() => {
    const original = window.fetch.bind(window);
    window.__exportOriginalFetch = original;
    window.fetch = (input, init) => {
      const command = decodeURIComponent(
        new URL(typeof input === "string" ? input : input.url).pathname.slice(
          1,
        ),
      );
      if (command === "pick_pdf_target")
        return new Promise((resolve) => {
          window.__releaseExportTarget = () =>
            resolve(
              new Response("null", {
                headers: {
                  "Content-Type": "application/json",
                  "Tauri-Response": "ok",
                },
              }),
            );
        });
      return original(input, init);
    };
  });
  await page
    .getByRole("button", { name: strings.exportPdf, exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => typeof window.__releaseExportTarget))
    .toBe("function");
  const exportCheckpoint = (await invoke("load_workspace")).data.documents.find(
    (d) => d.id === doc.id,
  );
  if (exportCheckpoint?.body !== exportGuardBody)
    throw new Error("Export started before latest note was durable");
  await page
    .locator(".window-actions")
    .getByRole("button", { name: strings.close, exact: true })
    .click();
  await expect(page.locator(".toast span")).toHaveText(strings.working);
  if (page.isClosed())
    throw new Error("Export allowed the native window to close");
  await page.evaluate(() => {
    window.fetch = window.__exportOriginalFetch;
    window.__releaseExportTarget();
    delete window.__exportOriginalFetch;
    delete window.__releaseExportTarget;
  });
  await expect(
    page.getByRole("button", { name: strings.exportPdf, exact: true }),
  ).toBeEnabled();
  await page.reload();
  await page
    .locator(".card-main")
    .filter({ hasText: "Upgrade preservation" })
    .click();
  await expect(area).toHaveValue(exportGuardBody);
  // Exercise the actual PDF renderer. Only the save-dialog selection is supplied by this CI fixture.
  await area.fill(
    exportGuardBody +
      "\n\n## PDF 中文分页\n\n- 列表一\n- 列表二\n\n| Key | Value |\n| --- | --- |\n| 中文 | 123 |\n\n" +
      Array.from(
        { length: 75 },
        (_, i) => `PDF sample paragraph ${i} 中文内容`,
      ).join("\n\n"),
  );
  await page.keyboard.press("Control+s");
  await page.locator(".statusbar").filter({ hasText: strings.saved }).waitFor();
  await page.evaluate(() => {
    window.__pdfAudit = [];
    const observer = new MutationObserver(() => {
      const text = [...document.querySelectorAll(".toast,[role=alert]")]
        .map((e) => e.textContent)
        .join(" | ");
      if (text && window.__pdfAudit.at(-1) !== text)
        window.__pdfAudit.push(text);
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  });
  const pdfPath = path.resolve("native-writing.pdf");
  const dialogApproval = promisify(execFile)(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      "scripts/acceptance-save-dialog.ps1",
      "-Target",
      pdfPath,
    ],
    { timeout: 50000 },
  );

  await page
    .getByRole("button", { name: strings.exportPdf, exact: true })
    .click();
  console.log((await dialogApproval).stdout);
  try {
    await expect
      .poll(
        async () => {
          try {
            return (await readFile(pdfPath)).subarray(0, 5).toString();
          } catch {
            return "";
          }
        },
        { timeout: 60000 },
      )
      .toBe("%PDF-");
  } catch (error) {
    console.log(
      "PDF export diagnostic",
      await page.locator(".toast,[role=alert]").allTextContents(),
      await page.evaluate(() => window.__pdfAudit),
    );
    await page.screenshot({ path: "native-pdf-error.png" });
    throw error;
  }

  const pdf = (await readFile(pdfPath)).toString("latin1");
  if (
    (pdf.match(/\/Type \/Page\b/g) ?? []).length < 2 ||
    !pdf.includes("/Subtype /Image")
  )
    throw new Error("Native PDF lost pages or images");
  await expect(
    invoke("export_pdf", { token: "C:/unauthorized.pdf" }),
  ).rejects.toBeDefined();
  const beforePrivate = await invoke("load_workspace");
  const lang = beforePrivate.data.settings.locale;
  const word = (cn, tw, en) =>
    lang === "en" ? en : lang === "zh-TW" ? tw : cn;
  await page.keyboard.press("Control+,");
  await page
    .locator(".settings-nav nav")
    .getByRole("button", {
      name: word(
        "安全与加密知识库",
        "安全與加密知識庫",
        "Security and encrypted vault",
      ),
      exact: true,
    })
    .click();
  await page
    .locator(".settings-content input[type=password]")
    .nth(0)
    .fill("native isolated passphrase");
  await page
    .locator(".settings-content input[type=password]")
    .nth(1)
    .fill("native isolated passphrase");
  await page
    .getByRole("button", {
      name: word("创建加密空间", "建立加密空間", "Create vault"),
      exact: true,
    })
    .click();
  await page
    .locator(".page-actions")
    .getByRole("button", { name: strings.new, exact: true })
    .click();
  await page.getByRole("dialog").locator("input").fill("Native secret fixture");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: strings.create, exact: true })
    .click();
  await page.locator(".live-editor").fill("Native private body 中文");
  await page.keyboard.press("Control+s");
  await page.locator(".statusbar").filter({ hasText: strings.saved }).waitFor();
  const cipher = await invoke("read_private_record", { record: "main" });
  const cipherText = Buffer.from(cipher.bytes).toString("utf8");
  if (
    cipherText.includes("Native private body") ||
    cipherText.includes("Native secret fixture") ||
    !cipherText.includes("orvia-encrypted-vault")
  )
    throw new Error("Private data was not encrypted");
  if (
    JSON.stringify((await invoke("load_workspace")).data).includes(
      "Native private body",
    )
  )
    throw new Error("Private data leaked into public SQLite");
  await page.reload();
  await page.locator(".vault-gate").waitFor();
  await page
    .locator(".vault-gate input[type=password]")
    .fill("native isolated passphrase");
  await page
    .getByRole("button", { name: word("解锁", "解鎖", "Unlock"), exact: true })
    .click();
  await page
    .locator(".card-main")
    .filter({ hasText: "Native secret fixture" })
    .waitFor();
  await page.keyboard.press("Control+,");
  await page
    .locator(".settings-nav nav")
    .getByRole("button", {
      name: word(
        "安全与加密知识库",
        "安全與加密知識庫",
        "Security and encrypted vault",
      ),
      exact: true,
    })
    .click();
  await page
    .getByRole("button", {
      name: word("打开普通知识库", "開啟普通知識庫", "Open regular workspace"),
      exact: true,
    })
    .click();
  await page
    .locator(".card-main")
    .filter({ hasText: "Upgrade preservation" })
    .waitFor();
  if (
    JSON.stringify((await invoke("load_workspace")).data).includes(
      "Native secret fixture",
    )
  )
    throw new Error("Public workspace separation failed");
  await page.keyboard.press("Control+,");
  await page
    .locator(".settings-nav nav")
    .getByRole("button", { name: strings.storageBackup, exact: true })
    .click();
  const backupParent = path.resolve("native-auto-backup");
  await mkdir(backupParent, { recursive: true });
  const folderApproval = promisify(execFile)(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      "scripts/acceptance-save-dialog.ps1",
      "-Mode",
      "Folder",
      "-Target",
      backupParent,
    ],
    { timeout: 50000 },
  );
  await page
    .getByRole("button", {
      name: word("选择备份目录", "選擇備份目錄", "Choose backup folder"),
      exact: true,
    })
    .click();
  await folderApproval;
  await expect
    .poll(() => invoke("backup_directory").catch(() => null))
    .toBeTruthy();
  const pickedBackup = await invoke("backup_directory");
  const backupFolder = pickedBackup.startsWith("\\\\?\\")
    ? pickedBackup.slice(4)
    : pickedBackup;
  if (
    !path
      .resolve(backupFolder)
      .toLowerCase()
      .startsWith(backupParent.toLowerCase() + path.sep)
  )
    throw new Error("Backup picker escaped isolated fixture");
  await page.locator(".settings-content input[type=number]").fill("3");
  await page
    .getByRole("button", {
      name: word("立即备份到该目录", "立即備份到該目錄", "Back up now"),
      exact: true,
    })
    .click();
  await expect(
    page
      .locator(".settings-content [role=status]")
      .filter({ hasText: "Orvia-auto-public-" }),
  ).toBeVisible();
  const backupName = (await readdir(backupFolder)).find((n) =>
    n.endsWith(".orvia"),
  );
  if (!backupName) throw new Error("Native backup missing");
  const backupBytes = await readFile(path.join(backupFolder, backupName));
  await writeFile(path.join(backupFolder, "user-file.txt"), "keep");
  for (let i = 0; i < 4; i++)
    await invoke("write_auto_backup", {
      bytes: [...backupBytes],
      private: false,
      keep: 3,
    });
  const beforeSchedule = await readdir(backupFolder);
  if (
    beforeSchedule.filter((n) => n.endsWith(".orvia")).length !== 3 ||
    (await readFile(path.join(backupFolder, "user-file.txt"), "utf8")) !==
      "keep"
  )
    throw new Error("Native retention violated file ownership");
  await page
    .getByRole("switch", { name: "Automatic backups", exact: true })
    .check();
  await expect
    .poll(
      async () =>
        (await readdir(backupFolder)).some(
          (n) => n.endsWith(".orvia") && !beforeSchedule.includes(n),
        ),
      { timeout: 45000 },
    )
    .toBe(true);
  const priorCheckpoint = (await invoke("read_recovery"))?.savedAt;
  await page
    .getByRole("switch", { name: "Automatic backups", exact: true })
    .uncheck();
  await page.keyboard.press("Control+s");
  await expect
    .poll(async () => (await invoke("read_recovery"))?.savedAt)
    .not.toBe(priorCheckpoint);
  await page.keyboard.press("Escape");
  const protectedAssets = (await invoke("storage_inventory")).assets.filter(
    (a) => a.referenced,
  );
  if (!protectedAssets.length)
    throw new Error("Referenced image inventory missing");
  await expect(
    invoke("cleanup_assets", { ids: [protectedAssets[0].id] }),
  ).rejects.toBeDefined();
  await invoke("read_asset", { id: protectedAssets[0].id });
  await invoke("write_recovery", {
    data: { schemaVersion: "damaged native fixture" },
  });
  await page.reload();
  await page
    .locator(".card-main")
    .filter({ hasText: "Upgrade preservation" })
    .waitFor();
  await expect.poll(() => invoke("recovery_quarantines")).not.toEqual([]);
  await page
    .getByRole("button", { name: strings.close, exact: true })
    .last()
    .count();
  // Setup grants are tested with synthetic keys. NEVER send a real inference.
  const initialAi = await invoke("ai_config");
  if (initialAi.config.enabled)
    throw new Error("AI must remain disabled after upgrade");
  if (
    process.env.EXPECT_LEGACY_AI_KEY === "true" &&
    (!initialAi.hasKey || !initialAi.authorized)
  )
    throw new Error("Existing key or once-only authorization was lost");
  const nativeDoc = (await invoke("load_workspace")).data.documents.find(
    (d) => d.title === "Upgrade preservation",
  );
  const request = () => ({
    id: crypto.randomUUID(),
    snapshot: {
      id: nativeDoc.id,
      title: nativeDoc.title,
      body: nativeDoc.body,
      fingerprint: "a".repeat(64),
      encrypted: false,
    },
    task: "Native authorization boundary - no inference",
    mode: "answer",
    locale: "en",
    scope: "note",
    history: [],
  });
  if (initialAi.hasKey) {
    await invoke("ai_save_config", {
      config: { ...initialAi.config, enabled: true },
    });
    const cancelledUpgrade = request();
    await invoke("ai_cancel", { id: cancelledUpgrade.id });
    await expect(
      invoke("ai_run", { request: cancelledUpgrade }),
    ).rejects.toThrow("AI_CANCELLED");
    await invoke("ai_revoke_authorization", { provider: "deepseek" });
    await expect(invoke("ai_run", { request: request() })).rejects.toThrow(
      "AI_AUTHORIZATION_REQUIRED",
    );
    await invoke("ai_save_config", { config: initialAi.config });
    await invoke("ai_delete_key", { provider: "deepseek" });
  }
  await page.keyboard.press("Control+,");
  await page
    .locator(".settings-nav nav")
    .getByRole("button", { name: strings.appearance, exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: strings.motionTitle, exact: true }),
  ).toHaveValue(legacyStable ? "moderate" : "elegant");
  await page
    .getByRole("combobox", { name: strings.motionTitle, exact: true })
    .selectOption("rapid");
  await expect
    .poll(async () => (await invoke("load_workspace")).data.settings.motion)
    .toBe("rapid");
  await page
    .locator(".settings-nav nav")
    .getByRole("button", { name: strings.aiSettings, exact: true })
    .click();
  const syntheticKey = "orvia-validation-only-not-a-real-key";
  await page.getByLabel(strings.aiKey, { exact: true }).fill(syntheticKey);
  const denial = setupDialog("DenyAI");
  await page
    .getByRole("button", { name: strings.aiSaveKey, exact: true })
    .click();
  console.log((await denial).stdout);
  await expect.poll(async () => (await invoke("ai_config")).hasKey).toBe(false);
  await expect(page.getByLabel(strings.aiKey, { exact: true })).toHaveValue("");
  await page.getByLabel(strings.aiKey, { exact: true }).fill(syntheticKey);
  const approval = setupDialog("ApproveAISetup");
  await page
    .getByRole("button", { name: strings.aiSaveKey, exact: true })
    .click();
  console.log((await approval).stdout);
  await expect
    .poll(async () => (await invoke("ai_config")).authorized)
    .toBe(true);
  await expect(page.getByLabel(strings.aiKey, { exact: true })).toHaveValue("");
  if (JSON.stringify(await invoke("load_workspace")).includes(syntheticKey))
    throw new Error("Credential leaked to workspace");
  await page
    .getByRole("switch", { name: strings.aiEnabled, exact: true })
    .check();
  await page
    .getByRole("button", { name: strings.aiSaveConfig, exact: true })
    .click();
  await expect
    .poll(async () => (await invoke("ai_config")).config.enabled)
    .toBe(true);
  // Pre-cancel before registration so this authorized native path cannot issue HTTP.
  const cancelled = request();
  await invoke("ai_cancel", { id: cancelled.id });
  await expect(invoke("ai_run", { request: cancelled })).rejects.toThrow(
    "AI_CANCELLED",
  );
  const stored = await invoke("load_workspace"),
    now = new Date().toISOString();
  stored.data.settings.aiConversations.push({
    id: crypto.randomUUID(),
    documentId: nativeDoc.id,
    title: "Native setup grant fixture",
    createdAt: now,
    updatedAt: now,
    messages: [
      {
        id: crypto.randomUUID(),
        role: "user",
        content: strings.aiSummarizePrompt,
        createdAt: now,
      },
      {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "Local native chat fixture; no model call.",
        createdAt: now,
      },
    ],
  });
  await invoke("save_workspace", {
    data: stored.data,
    expectedRevision: stored.revision,
  });
  await page.reload();
  await page
    .locator(".card-main")
    .filter({ hasText: "Upgrade preservation" })
    .click();
  await page
    .getByRole("button", { name: strings.aiTitle, exact: true })
    .click();
  await expect(
    page.getByRole("log", { name: strings.aiChatMessages }),
  ).toContainText("Local native chat fixture");
  await page
    .getByRole("textbox", { name: strings.aiChatInput, exact: true })
    .fill("Direct send is enabled - not sent in acceptance");
  await expect(
    page.getByRole("button", { name: strings.aiChatSend, exact: true }),
  ).toBeEnabled();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("button", { name: strings.aiClosePanel, exact: true })
    .click();
  await page.keyboard.press("Control+,");
  await page
    .locator(".settings-nav nav")
    .getByRole("button", { name: strings.aiSettings, exact: true })
    .click();
  await page
    .getByRole("button", { name: strings.aiRevokeAuthorization, exact: true })
    .click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: strings.confirm, exact: true })
    .click();
  await expect
    .poll(async () => (await invoke("ai_config")).authorized)
    .toBe(false);
  await expect(invoke("ai_run", { request: request() })).rejects.toThrow(
    "AI_AUTHORIZATION_REQUIRED",
  );
  await page
    .getByRole("button", { name: strings.aiDeleteKey, exact: true })
    .click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: strings.confirm, exact: true })
    .click();
  await expect.poll(async () => (await invoke("ai_config")).hasKey).toBe(false);
  await page
    .getByRole("switch", { name: strings.aiEnabled, exact: true })
    .uncheck();
  await page
    .getByRole("button", { name: strings.aiSaveConfig, exact: true })
    .click();
  await expect
    .poll(async () => (await invoke("ai_config")).config.enabled)
    .toBe(false);
  await page.keyboard.press("Escape");
  await writeFile(
    "native-validation.json",
    JSON.stringify(
      {
        previous: previousVersion,
        current: "0.1.1",
        uiVersionMatchesInstaller: true,
        featurePreviewDoesNotNavigate: true,
        exportCloseBlockedAndNotePreserved: true,
        installerUpgrade: true,
        signedGithubUpdater: process.env.USE_UPDATER === "true",
        sqlitePreserved: true,
        deltaSave: true,
        history: true,
        webviewReload: true,
        batchManagement: true,
        settingsPage: true,
        deleteConfirmation: true,
        autoUpdateSetting: true,
        singleContextMove: true,
        findReplace: true,
        localImagePasteDrop: true,
        imageOptionsAndPreview: true,
        writingPosition: true,
        pdfExport: true,
        pdfAuthorization: true,
        encryptedVault: true,
        authorizedBackupDirectory: true,
        autoBackupRetention: true,
        automaticBackupSchedule: true,
        publicPrivateSeparation: true,
        referencedAssetProtection: true,
        damagedRecoveryQuarantine: true,
        aiDefaultOff: true,
        aiCredentialProtection: true,
        aiSetupConsentDenied: true,
        aiSetupConsentAccepted: true,
        aiAuthorizationRevoked: true,
        aiLegacyKeyPreserved: legacyStable
          ? null
          : process.env.EXPECT_LEGACY_AI_KEY === "true",
        aiExistingAuthorizationPreserved: legacyStable ? null : true,
        aiCrossVersionChatPreserved: legacyStable ? null : true,
        motionPreferencePreserved: true,
        aiChatHistoryPreserved: true,
        realProviderInference: false,
      },
      null,
      2,
    ),
  );
  await page.screenshot({ path: "native-upgrade.png" });
}
await browser.close().catch(() => {});
