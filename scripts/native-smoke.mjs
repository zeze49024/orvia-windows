// Runs ONLY against a disposable CI installation with WebView2 debugging enabled.
import { chromium } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
const phase = process.argv[2];
if (!process.env.CI || !["seed", "verify", "update"].includes(phase))
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
    body: "# Native upgrade fixture\n\n中文内容 retained from rc2",
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
    .getByText("v0.1.0-rc2 → v0.1.0-rc3", { exact: true })
    .waitFor({ timeout: 60000 });
  const closed = page.waitForEvent("close", { timeout: 120000 });
  await page
    .getByRole("button", { name: strings.updateInstall, exact: true })
    .click();
  await closed;
} else {
  const loaded = await invoke("load_workspace");
  const doc = loaded.data.documents.find(
    (d) => d.title === "Upgrade preservation",
  );
  if (
    !doc?.body.includes("中文内容 retained from rc2") ||
    !doc.starred ||
    doc.tags[0] !== "upgrade"
  )
    throw new Error("Upgrade lost data");
  const changed = { ...doc, body: doc.body + "\n\nSaved by rc3" };
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
    !(await page.locator(".live-editor").innerText()).includes("Saved by rc3")
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
  await writeFile(
    "native-validation.json",
    JSON.stringify(
      {
        previous: "0.1.0-rc2",
        current: "0.1.0-rc3",
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
      },
      null,
      2,
    ),
  );
  await page.screenshot({ path: "native-upgrade.png" });
}
await browser.close().catch(() => {});
