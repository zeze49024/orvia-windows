import { useState } from "react";
import { store } from "@/core/storage";
import { defaultShortcuts } from "@/core/model";
import { words, validateShortcuts, templates } from "@/core/productivity";
import type { Confirm } from "@/hooks/use-confirmation";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
export function ProductivitySettings({
  confirm,
  busy,
}: {
  confirm: Confirm;
  busy: boolean;
}) {
  const locale = store.data.settings.locale,
    w = (a: string, b: string, c: string) => words(locale, a, b, c);
  const [name, setName] = useState(""),
    [body, setBody] = useState(""),
    [id, setId] = useState(""),
    [keys, setKeys] = useState(store.data.settings.shortcuts),
    [error, setError] = useState("");
  const labels = {
    searchAll: w("全局搜索", "全域搜尋", "Global search"),
    newNote: w("新建笔记", "新增筆記", "New note"),
    settings: w("设置", "設定", "Settings"),
    save: w("保存", "儲存", "Save"),
    find: w("查找", "尋找", "Find"),
    replace: w("替换", "取代", "Replace"),
    lockVault: w("锁定加密空间", "鎖定加密空間", "Lock vault"),
  };
  return (
    <div className="modal-stack">
      <h3>{w("笔记模板", "筆記範本", "Note templates")}</h3>
      <p>
        {templates(locale)
          .map((t) => t.name)
          .join(" · ")}
      </p>
      <select
        aria-label={w("编辑模板", "編輯範本", "Edit template")}
        value={id}
        onChange={(e) => {
          const t = store.data.settings.templates.find(
            (t) => t.id === e.target.value,
          );
          setId(t?.id ?? "");
          setName(t?.name ?? "");
          setBody(t?.body ?? "");
        }}
      >
        <option value="">{w("新模板", "新增範本", "New template")}</option>
        {store.data.settings.templates.map((t) => (
          <option value={t.id} key={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <Input
        aria-label={w("模板名称", "範本名稱", "Template name")}
        placeholder={w("模板名称", "範本名稱", "Template name")}
        maxLength={100}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <textarea
        aria-label={w("模板 Markdown", "範本 Markdown", "Template Markdown")}
        maxLength={1000000}
        rows={8}
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="modal-actions">
        <Button
          disabled={
            busy ||
            !name.trim() ||
            (!id && store.data.settings.templates.length >= 100)
          }
          onClick={() => {
            const next = {
              id: id || crypto.randomUUID(),
              name: name.trim(),
              body,
            };
            store.change((s) => ({
              ...s,
              settings: {
                ...s.settings,
                templates: [
                  ...s.settings.templates.filter((t) => t.id !== next.id),
                  next,
                ],
              },
            }));
            setId(next.id);
          }}
        >
          {w("保存模板", "儲存範本", "Save template")}
        </Button>
        <Button
          variant="outline"
          disabled={busy || !id}
          onClick={() =>
            void (async () => {
              if (
                await confirm({
                  title: w("删除模板", "刪除範本", "Delete template"),
                  description: name,
                  danger: true,
                })
              ) {
                store.change((s) => ({
                  ...s,
                  settings: {
                    ...s.settings,
                    templates: s.settings.templates.filter((t) => t.id !== id),
                  },
                }));
                setId("");
                setName("");
                setBody("");
              }
            })()
          }
        >
          {w("删除", "刪除", "Delete")}
        </Button>
      </div>
      <h3>{w("快捷键", "快速鍵", "Keyboard shortcuts")}</h3>
      <p>
        {w(
          "使用 Ctrl 或 Ctrl+Shift 组合；系统剪贴板、撤销、关闭等组合不可覆盖。所有操作也可通过界面按钮使用。",
          "使用 Ctrl 或 Ctrl+Shift 組合；系統剪貼簿、復原、關閉等組合不可覆蓋。所有操作也可透過介面按鈕使用。",
          "Use Ctrl or Ctrl+Shift. Clipboard, undo and close shortcuts are reserved. Every action is also available through buttons.",
        )}
      </p>
      {(Object.keys(keys) as (keyof typeof keys)[]).map((k) => (
        <label className="settings-row" key={k}>
          <b>{labels[k]}</b>
          <Input
            aria-label={labels[k]}
            value={keys[k]}
            maxLength={32}
            onChange={(e) => setKeys({ ...keys, [k]: e.target.value })}
          />
        </label>
      ))}
      <p role="alert">{error}</p>
      <div className="modal-actions">
        <Button
          disabled={busy}
          onClick={() => {
            try {
              const shortcuts = validateShortcuts(keys);
              store.change((s) => ({
                ...s,
                settings: { ...s.settings, shortcuts },
              }));
              setKeys(shortcuts);
              setError("");
            } catch {
              setError(
                w(
                  "快捷键格式错误、重复或与保留快捷键冲突。",
                  "快速鍵格式錯誤、重複或與保留快速鍵衝突。",
                  "Invalid, duplicate or reserved shortcut.",
                ),
              );
            }
          }}
        >
          {w("保存快捷键", "儲存快速鍵", "Save shortcuts")}
        </Button>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => {
            setKeys({ ...defaultShortcuts });
            store.change((s) => ({
              ...s,
              settings: { ...s.settings, shortcuts: { ...defaultShortcuts } },
            }));
            setError("");
          }}
        >
          {w("恢复默认", "還原預設", "Reset defaults")}
        </Button>
      </div>
    </div>
  );
}
