import "fake-indexeddb/auto";
import { describe, it, expect } from "vitest";
import { emptyWorkspace, newDocument } from "./model";
import { putAsset } from "./storage";
import { exportMarkdownDocument } from "./markdown-export";

describe("single-file Markdown export", () => {
  it("exports only UTF-8 body as a safely named .md without adding a filename heading", async () => {
    const data = emptyWorkspace(),
      body = "# 原有标题\n\n中文 **正文**\n\n- [ ] 计划\n";
    const doc = newDocument(data.libraries[0].id, "文件:名称.md", body);
    data.documents.push(doc);
    const file = await exportMarkdownDocument(data, doc.id);
    expect(file.name).toBe("文件_名称.md");
    expect(new TextDecoder().decode(file.bytes)).toBe(body);
    expect(file.bytes.slice(0, 2)).not.toEqual(new Uint8Array([80, 75]));
  });
  it("embeds local images inside Markdown while preserving asset mentions in code", async () => {
    const data = emptyWorkspace(),
      asset = await putAsset(
        new Uint8Array([137, 80, 78, 71, 1, 2, 3]),
        "image/png",
      );
    data.assets.push(asset);
    const doc = newDocument(
      data.libraries[0].id,
      "图片",
      `![示例](asset:${asset.id} "说明")\n\n\`asset:${asset.id}\`\n\n![再次使用](asset:${asset.id})`,
    );
    data.documents.push(doc);
    const result = await exportMarkdownDocument(data, doc.id),
      text = new TextDecoder().decode(result.bytes);
    expect(text).toContain(
      '![示例](data:image/png;base64,iVBORwECAw== "说明")',
    );
    expect(text).toContain(`\`asset:${asset.id}\``);
    expect(text).not.toContain("../assets/");
    expect(text.match(/data:image\/png;base64,/g)).toHaveLength(2);
    expect(doc.body).toContain(`![示例](asset:${asset.id}`);
  });
  it("refuses missing or recycled documents rather than saving an empty file", async () => {
    const data = emptyWorkspace(),
      doc = newDocument(data.libraries[0].id, "回收文档");
    doc.deletedAt = new Date().toISOString();
    data.documents.push(doc);
    await expect(exportMarkdownDocument(data, doc.id)).rejects.toThrow(
      "DOCUMENT_NOT_FOUND",
    );
    await expect(exportMarkdownDocument(data, "missing")).rejects.toThrow(
      "DOCUMENT_NOT_FOUND",
    );
  });
});
