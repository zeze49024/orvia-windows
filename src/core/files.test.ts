import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  readDir: vi.fn(),
  writeFile: vi.fn(),
}));
vi.mock("./storage", () => ({ native: true, getAsset: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.open }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  readDir: mocks.readDir,
  writeFile: mocks.writeFile,
}));
vi.mock("@tauri-apps/api/path", () => ({
  join: async (...parts: string[]) => parts.join("/"),
}));
import { saveFiles } from "./files";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.open.mockResolvedValue("C:/selected");
  mocks.readDir.mockResolvedValue([{ name: "note.md" }]);
  mocks.writeFile.mockResolvedValue(undefined);
});
it("writes independent files only in the selected folder and never overwrites existing names", async () => {
  const bytes = new Uint8Array([65]);
  expect(
    await saveFiles([
      { name: "Note.md", bytes },
      { name: "Note.md", bytes },
    ]),
  ).toBe(true);
  expect(mocks.open).toHaveBeenCalledWith({
    directory: true,
    multiple: false,
    recursive: true,
  });
  expect(mocks.writeFile.mock.calls).toEqual([
    ["C:/selected/Note (2).md", bytes, { createNew: true }],
    ["C:/selected/Note (3).md", bytes, { createNew: true }],
  ]);
});
it("cancels without writing and reports the actual count on partial failure", async () => {
  mocks.open.mockResolvedValueOnce(null);
  expect(await saveFiles([{ name: "A.md", bytes: new Uint8Array([65]) }])).toBe(
    false,
  );
  expect(mocks.writeFile).not.toHaveBeenCalled();
  mocks.writeFile
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error("disk full"));
  await expect(
    saveFiles([
      { name: "A.md", bytes: new Uint8Array([65]) },
      { name: "B.md", bytes: new Uint8Array([66]) },
    ]),
  ).rejects.toThrow("EXPORT_PARTIAL 1/2");
});
