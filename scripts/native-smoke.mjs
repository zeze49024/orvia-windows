// Runs ONLY against a disposable CI installation with WebView2 debugging enabled.
import { chromium, expect } from "@playwright/test";
import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
const phase = process.argv[2];
if (
  !process.env.CI ||
  !["seed", "verify", "update", "crash", "recover"].includes(phase)
)
  throw new Error("Disposable CI environment required");
let browser;
let connectionError;
for (let attempt = 0; attempt < 40; attempt++) {
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
if (phase === "seed") {
  const loaded = await invoke("load_workspace");
  const data = loaded.data;
  const now = new Date().toISOString();
  data.documents.push({
    id: "af485e10-f680-4ff6-8b40-af799171e221",
    libraryId: data.libraries[0].id,
    title: "Upgrade preservation",
    body: "# Native upgrade fixture\n\n中文内容 retained from beta1",
    tags: ["upgrade"],
    starred: true,
    createdAt: now,
    updatedAt: now,
    openedAt: null,
    deletedAt: null,
  });
  await invoke("save_workspace", { data, expectedRevision: loaded.revision });
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
  await page
    .getByRole("button", { name: strings.settings + " Ctrl ,", exact: true })
    .click();
  await page
    .locator(".settings-nav nav")
    .getByRole("button", { name: strings.versionUpdates, exact: true })
    .click();
  await page
    .getByRole("button", { name: strings.checkUpdates, exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByText("v0.1.1-beta1 → v0.1.1-beta2", { exact: true })
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
  const loaded = await invoke("load_workspace");
  const doc = loaded.data.documents.find(
    (d) => d.title === "Upgrade preservation",
  );
  if (
    !doc?.body.includes("中文内容 retained from beta1") ||
    !doc.starred ||
    doc.tags[0] !== "upgrade"
  )
    throw new Error("Upgrade lost data");
  const changed = { ...doc, body: doc.body + "\n\nSaved by v0.1.1-beta2" };
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
      "Saved by v0.1.1-beta2",
    )
  )
    throw new Error("Native editor reload failed");
  await page
    .getByRole("button", { name: strings.settings + " Ctrl ,", exact: true })
    .click();
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
  // Exercise the actual PDF renderer. Only the save-dialog selection is supplied by this CI fixture.
  await area.fill(
    written.body +
      "\n\n## PDF 中文分页\n\n- 列表一\n- 列表二\n\n| Key | Value |\n| --- | --- |\n| 中文 | 123 |\n\n" +
      Array.from(
        { length: 75 },
        (_, i) => `PDF sample paragraph ${i} 中文内容`,
      ).join("\n\n"),
  );
  await page.keyboard.press("Control+s");
  await page.locator(".statusbar").filter({ hasText: strings.saved }).waitFor();
  const pdfPath = path.resolve("native-writing.pdf");
  await page.evaluate((pdfPath) => {
    const original = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const cmd = decodeURIComponent(
        new URL(typeof input === "string" ? input : input.url).pathname.slice(
          1,
        ),
      );
      if (cmd === "plugin:dialog|save")
        return Promise.resolve(
          new Response(JSON.stringify(pdfPath), {
            headers: {
              "Content-Type": "application/json",
              "Tauri-Response": "ok",
            },
          }),
        );
      return original(input, init);
    };
  }, pdfPath);
  await page
    .getByRole("button", { name: strings.exportPdf, exact: true })
    .click();
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
  const pdf = (await readFile(pdfPath)).toString("latin1");
  if (
    (pdf.match(/\/Type \/Page\b/g) ?? []).length < 2 ||
    !pdf.includes("/Subtype /Image")
  )
    throw new Error("Native PDF lost pages or images");
  await writeFile(
    "native-validation.json",
    JSON.stringify(
      {
        previous: "0.1.1-beta1",
        current: "0.1.1-beta2",
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
      },
      null,
      2,
    ),
  );
  await page.screenshot({ path: "native-upgrade.png" });
}
await browser.close().catch(() => {});
