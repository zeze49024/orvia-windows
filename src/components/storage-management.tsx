import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { inventory, cleanup, type Inventory } from "@/core/storage-management";
import { native, store } from "@/core/storage";
import { words } from "@/core/productivity";
import { saveFile } from "@/core/files";
import type { Confirm } from "@/hooks/use-confirmation";
import { Button } from "./ui/button";
export function StorageManagement({
  busy,
  run,
  confirm,
}: {
  busy: boolean;
  run: (a: () => Promise<void>) => Promise<void>;
  confirm: Confirm;
}) {
  const [preview, setPreview] = useState<Inventory | null>(null),
    [quarantines, setQuarantines] = useState<string[]>([]),
    [status, setStatus] = useState("");
  const w = (a: string, b: string, c: string) =>
      words(store.data.settings.locale, a, b, c),
    size = (n: number) => (n / 1048576).toFixed(2) + " MB";
  const scan = async () => {
    setPreview(await inventory());
    if (native) setQuarantines(await invoke<string[]>("recovery_quarantines"));
  };
  const unused = preview?.assets.filter((a) => !a.referenced) ?? [];
  return (
    <div className="modal-stack">
      <h3>
        {w(
          "存储分析与安全清理",
          "儲存分析與安全清理",
          "Storage and safe cleanup",
        )}
      </h3>
      <p>
        {w(
          "保留正文、回收站、历史版本及待恢复草稿引用的图片。不会删除备份、损坏草稿或数据库。",
          "保留內文、回收站、歷史版本及待還原草稿引用的圖片。不會刪除備份、損壞草稿或資料庫。",
          "Retains images referenced by notes, trash, history and recovery drafts. Backups, damaged drafts and databases are kept.",
        )}
      </p>
      <Button variant="outline" disabled={busy} onClick={() => void run(scan)}>
        {w("分析存储", "分析儲存", "Analyze storage")}
      </Button>
      {preview && (
        <>
          <p>
            {w("图片资源", "圖片資源", "Image assets")}: {preview.assets.length}{" "}
            · {size(preview.assets.reduce((n, a) => n + a.size, 0))}
          </p>
          <p>
            SQLite: {size(preview.database)} · {w("草稿", "草稿", "Recovery")}:{" "}
            {size(preview.recovery)} · {w("加密空间", "加密空間", "Vault")}:{" "}
            {size(preview.vault)}
          </p>
          <p>
            {w(
              "可清理的未引用图片",
              "可清理的未引用圖片",
              "Unreferenced images",
            )}
            : {unused.length} · {size(unused.reduce((n, a) => n + a.size, 0))}
          </p>
          <Button
            variant="outline"
            disabled={
              busy ||
              !unused.length ||
              (!native && store.vaultMode === "public")
            }
            onClick={() =>
              void run(async () => {
                if (
                  await confirm({
                    title: w(
                      "清理未引用图片？",
                      "清理未引用圖片？",
                      "Clean unused images?",
                    ),
                    description: `${unused.length} · ${size(unused.reduce((n, a) => n + a.size, 0))}`,
                    danger: true,
                  })
                ) {
                  const n = await cleanup(preview);
                  setStatus(`${n} ✓`);
                  await scan();
                }
              })
            }
          >
            {w("清理未引用图片", "清理未引用圖片", "Clean unused images")}
          </Button>
        </>
      )}
      {!!quarantines.length && (
        <>
          <h3>
            {w(
              "隔离的损坏草稿",
              "隔離的損壞草稿",
              "Quarantined recovery files",
            )}
          </h3>
          <p>
            {w(
              "保留原始数据供排查。明文草稿可能含笔记内容，请谨慎分享。",
              "保留原始資料供排查。明文草稿可能含筆記內容，請謹慎分享。",
              "Original data is preserved for diagnosis. Plaintext recovery files may contain private notes; share carefully.",
            )}
          </p>
          {quarantines.map((name) => (
            <Button
              key={name}
              variant="outline"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const bytes = await invoke<number[]>("read_quarantine", {
                    name,
                  });
                  await saveFile(name, new Uint8Array(bytes), [
                    name.endsWith(".json") ? "json" : "orvia-vault",
                  ]);
                })
              }
            >
              {name}
            </Button>
          ))}
        </>
      )}
      <p role="status">{status}</p>
    </div>
  );
}
