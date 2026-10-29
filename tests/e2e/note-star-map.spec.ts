import { test, expect, type Page } from "@playwright/test";
async function seed(page: Page) {
  await page.goto("/");
  await page.locator(".app-shell").waitFor();
  await page.evaluate(async () => {
    const modelPath = "/src/core/model.ts",
      storagePath = "/src/core/storage.ts";
    const { newDocument } = await import(modelPath),
      { store } = await import(storagePath);
    store.change((s) => {
      const first = s.libraries[0],
        second = {
          id: crypto.randomUUID(),
          name: "产品与设计",
          color: "purple",
        };
      const titles = [
        "知识的连接",
        "界面设计原则",
        "2026-10-29 灵感日记",
        "阅读的复利",
        "写作工作流",
        "交互设计清单",
        "产品思考",
        "下一个灵感",
        "色彩与留白",
        "长期主义",
        "关于 Orvia",
        "每周复盘",
      ];
      const documents = titles.map((title, i) => {
        const d = newDocument(
          i < 6 ? first.id : second.id,
          title,
          i === 0
            ? "让独立的想法，逐渐形成清晰的脉络。\n\n[[界面设计原则]] [[阅读的复利]] [[写作工作流]]"
            : i === 1
              ? "[[产品思考]]"
              : i === 6
                ? "[[知识的连接]]"
                : "记录想法，让知识慢慢生长。",
        );
        d.pinned = i === 5;
        d.starred = i === 0;
        return d;
      });
      const removed = newDocument(first.id, "已删除的私人笔记");
      removed.deletedAt = new Date().toISOString();
      return {
        ...s,
        libraries: [first, second],
        documents: [...documents, removed],
      };
    });
    await store.flush();
  });
  await page.getByRole("button", { name: "笔记星图", exact: true }).click();
  await expect(page.locator(".star-map-stage")).toHaveAttribute(
    "aria-busy",
    "false",
  );
}
test("star map uses local graph, filters, layouts, pan/zoom, details and opens actual notes", async ({
  page,
}) => {
  await seed(page);
  expect(
    await page
      .locator(".sidebar > .nav-group")
      .first()
      .locator("button")
      .allTextContents(),
  ).toEqual(expect.arrayContaining(["笔记星图"]));
  await expect(page.locator(".star-map-node")).toHaveCount(14);
  await expect(page.locator(".star-map-edge.link")).toHaveCount(5);
  await expect(page.locator(".star-map-edge.membership")).toHaveCount(12);
  await expect(
    page.locator(".star-map-node").filter({ hasText: "已删除的私人笔记" }),
  ).toHaveCount(0);
  await page.screenshot({
    path: "test-results/v012-star-map-light.png",
    animations: "disabled",
  });
  for (const name of ["环形", "径向", "网格", "力导向"]) {
    await page.getByRole("button", { name, exact: true }).click();
    await expect(
      page.getByRole("button", { name, exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  }
  const before = await page.locator(".star-map-zoom span").textContent();
  await page.getByRole("button", { name: "放大星图", exact: true }).click();
  expect(await page.locator(".star-map-zoom span").textContent()).not.toBe(
    before,
  );
  await page.getByRole("button", { name: "适应画布", exact: true }).click();
  const note = page.locator(".star-map-node").filter({ hasText: "知识的连接" });
  const initialTransform = await note.getAttribute("transform");
  const box = await note.boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + 8);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 50, box!.y + 28, {
    steps: 8,
  });
  await page.mouse.up();
  expect(await note.getAttribute("transform")).not.toBe(initialTransform);
  await page.getByRole("button", { name: "适应画布", exact: true }).click();
  const canvasTransform = await page
    .locator(".star-map-canvas > g")
    .getAttribute("transform");
  const canvasBox = await page.locator(".star-map-canvas").boundingBox();
  await page.mouse.move(canvasBox!.x + 15, canvasBox!.y + 15);
  await page.mouse.down();
  await page.mouse.move(canvasBox!.x + 60, canvasBox!.y + 45, { steps: 8 });
  await page.mouse.up();
  expect(
    await page.locator(".star-map-canvas > g").getAttribute("transform"),
  ).not.toBe(canvasTransform);
  await page.getByRole("button", { name: "适应画布", exact: true }).click();
  await note.click();
  await expect(page.locator(".star-map-detail h2")).toHaveText("知识的连接");
  await page.getByRole("button", { name: "日记", exact: true }).click();
  await expect(page.locator(".star-map-node.graph-diary")).toHaveCount(0);
  await page.getByRole("button", { name: "日记", exact: true }).click();
  await page.getByRole("textbox", { name: "查找笔记、标签…" }).fill("界面设计");
  await expect(page.locator(".star-map-node")).toHaveCount(2);
  await page.getByRole("button", { name: "清空星图搜索" }).click();
  await page
    .getByRole("combobox", { name: "按知识库筛选" })
    .selectOption({ label: "产品与设计" });
  await expect(page.locator(".star-map-stage")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(page.locator(".star-map-node")).toHaveCount(7);
  await page.getByRole("button", { name: "展开星图", exact: true }).click();
  await expect(page.locator(".star-map")).toHaveClass(/star-map-expanded/);
  await page.keyboard.press("Escape");
  await expect(page.locator(".star-map")).not.toHaveClass(/star-map-expanded/);
  await page.getByRole("button", { name: "重置星图", exact: true }).click();
  await expect(page.locator(".star-map-stage")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(page.locator(".star-map-node")).toHaveCount(14);
  await page
    .locator(".star-map-node")
    .filter({ hasText: "知识的连接" })
    .dblclick();
  await expect(page.locator(".document-title")).toHaveValue("知识的连接");
});
test("graph supports dark theme, keyboard access, empty results and library navigation", async ({
  page,
}) => {
  await seed(page);
  await page.evaluate(async () => {
    const p = "/src/core/storage.ts";
    const { store } = await import(p);
    store.change((s) => ({ ...s, settings: { ...s.settings, theme: "dark" } }));
    await store.flush();
  });
  await page.screenshot({
    path: "test-results/v012-star-map-dark.png",
    animations: "disabled",
  });
  await page
    .getByRole("textbox", { name: "查找笔记、标签…" })
    .fill("不存在的节点");
  await expect(page.getByText("没有匹配的节点", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "重置筛选", exact: true }).click();
  await page.getByRole("button", { name: "星图使用说明", exact: true }).click();
  await expect(page.locator(".star-map-help")).toContainText("重名");
  const lib = page
    .locator(".star-map-node.graph-library")
    .filter({ hasText: "产品与设计" });
  await lib.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".star-map")).toHaveCount(0);
  await expect(page.locator(".page-intro h1")).toContainText("产品与设计");
});
