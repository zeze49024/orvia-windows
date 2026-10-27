import { useState } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { store } from "@/core/storage";
import { vaultSession } from "@/core/vault";
import { openVault } from "@/core/vault-crypto";
import { chooseFiles, saveFile } from "@/core/files";
import { words } from "@/core/productivity";
import type { Confirm } from "@/hooks/use-confirmation";
export function VaultPanel({
  busy,
  run,
  confirm,
  gate = false,
}: {
  busy: boolean;
  run: (action: () => Promise<void>) => Promise<void>;
  confirm: Confirm;
  gate?: boolean;
}) {
  const [password, setPassword] = useState(""),
    [repeat, setRepeat] = useState(""),
    [copy, setCopy] = useState(false);
  const locale = store.data.settings.locale,
    w = (a: string, b: string, c: string) => words(locale, a, b, c);
  const clear = () => {
    setPassword("");
    setRepeat("");
  };
  const act = (action: () => Promise<void>) =>
    void run(async () => {
      try {
        await action();
      } finally {
        clear();
      }
    });
  return (
    <div className={gate ? "vault-gate" : "settings-group vault-settings"}>
      <h2>{w("加密知识库", "加密知識庫", "Encrypted vault")}</h2>
      <p>
        {w(
          "独立加密空间，密码无法找回。普通知识库保持原样；锁定前会保存，加密备份仍需牢记密码。",
          "獨立加密空間，密碼無法找回。普通知識庫保持原樣；鎖定前會儲存，加密備份仍需牢記密碼。",
          "A separate encrypted space. Passwords cannot be recovered. Your regular workspace is retained. Save before locking and keep your backup password safe.",
        )}
      </p>
      <label>
        {w(
          "密码（至少 12 个字符）",
          "密碼（至少 12 個字元）",
          "Password (at least 12 characters)",
        )}
        <Input
          disabled={busy}
          type="password"
          autoComplete="off"
          maxLength={1024}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      {(!store.vaultAvailable || vaultSession.active) && (
        <label>
          {w("再次输入密码", "再次輸入密碼", "Repeat password")}
          <Input
            disabled={busy}
            type="password"
            autoComplete="off"
            maxLength={1024}
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
          />
        </label>
      )}
      {!store.vaultAvailable && (
        <label>
          <input
            type="checkbox"
            checked={copy}
            onChange={(e) => setCopy(e.target.checked)}
          />
          {w(
            "复制普通知识库（原件仍是明文，不会删除）",
            "複製普通知識庫（原件仍是明文，不會刪除）",
            "Copy regular workspace (plaintext originals remain)",
          )}
        </label>
      )}
      <div className="modal-actions">
        {!store.vaultAvailable && (
          <Button
            disabled={busy || password.length < 12 || password !== repeat}
            onClick={() =>
              act(async () => {
                if (
                  !copy ||
                  (await confirm({
                    title: w(
                      "复制明文内容？",
                      "複製明文內容？",
                      "Copy plaintext content?",
                    ),
                    description: w(
                      "这会创建加密副本，普通知识库、旧备份和磁盘原件仍保留。",
                      "這會建立加密副本，普通知識庫、舊備份和磁碟原件仍保留。",
                      "This creates an encrypted copy. Regular notes, old backups and disk originals remain.",
                    ),
                  }))
                )
                  await store.createVault(password, copy);
              })
            }
          >
            {w("创建加密空间", "建立加密空間", "Create vault")}
          </Button>
        )}
        {store.vaultAvailable && !vaultSession.active && (
          <Button
            disabled={busy || !password}
            onClick={() => act(() => store.unlockVault(password))}
          >
            {w("解锁", "解鎖", "Unlock")}
          </Button>
        )}
        {vaultSession.active && (
          <>
            <Button
              disabled={busy}
              onClick={() => act(() => store.lockVault())}
            >
              {w("锁定", "鎖定", "Lock")}
            </Button>
            <Button
              variant="outline"
              disabled={busy || password.length < 12 || password !== repeat}
              onClick={() =>
                act(async () => {
                  if (
                    await confirm({
                      title: w("更改密码", "更改密碼", "Change password"),
                      description: w(
                        "旧备份仍需旧密码。请先导出一份当前加密备份。",
                        "舊備份仍需舊密碼。請先匯出一份目前加密備份。",
                        "Old backups still require the old password. Export a current encrypted backup first.",
                      ),
                    })
                  )
                    await store.changeVaultPassword(password);
                })
              }
            >
              {w("更改密码", "更改密碼", "Change password")}
            </Button>
          </>
        )}
        {store.vaultMode !== "public" && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => act(() => store.openPublic())}
          >
            {w("打开普通知识库", "開啟普通知識庫", "Open regular workspace")}
          </Button>
        )}
      </div>
      {vaultSession.active && (
        <>
          <div className="settings-row">
            <b>
              {w(
                "空闲自动锁定（分钟）",
                "閒置自動鎖定（分鐘）",
                "Auto-lock after idle minutes",
              )}
            </b>
            <select
              aria-label="Auto-lock"
              value={store.data.settings.vaultAutoLockMinutes}
              onChange={(e) =>
                store.change((s) => ({
                  ...s,
                  settings: {
                    ...s.settings,
                    vaultAutoLockMinutes: Number(e.target.value) as
                      1 | 5 | 15 | 30,
                  },
                }))
              }
            >
              {[1, 5, 15, 30].map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              act(async () => {
                await store.flush();
                await saveFile(
                  "Orvia-encrypted.orvia-vault",
                  await vaultSession.backup(store.recovery),
                  ["orvia-vault"],
                );
              })
            }
          >
            {w("导出加密备份", "匯出加密備份", "Export encrypted backup")}
          </Button>
        </>
      )}
      {vaultSession.active && (
        <Button
          variant="outline"
          disabled={busy || !password}
          onClick={() =>
            act(async () => {
              const [file] = await chooseFiles(["orvia-vault"], false);
              if (!file) return;
              const opened = await openVault(file.bytes, password),
                payload = await vaultSession.validate(opened.value);
              if (
                await confirm({
                  title: w(
                    "恢复加密备份",
                    "還原加密備份",
                    "Restore encrypted backup",
                  ),
                  description: `${payload.workspace.documents.length} notes · ${payload.workspace.assets.length} images · ${Object.values(payload.history).reduce((n, v) => n + v.length, 0)} history`,
                  names: payload.workspace.documents.map((d) => d.title),
                })
              )
                await store.mergeVaultBackup(payload);
            })
          }
        >
          {w(
            "恢复加密备份（输入备份密码）",
            "還原加密備份（輸入備份密碼）",
            "Restore encrypted backup (enter backup password)",
          )}
        </Button>
      )}
      {!store.vaultAvailable && (
        <Button
          variant="outline"
          disabled={busy || password.length < 12 || password !== repeat}
          onClick={() =>
            act(async () => {
              const [file] = await chooseFiles(["orvia-vault"], false);
              if (!file) return;
              const opened = await openVault(file.bytes, password),
                payload = await vaultSession.validate(opened.value);
              await store.createVaultFromBackup(password, payload);
            })
          }
        >
          {w(
            "从加密备份创建",
            "從加密備份建立",
            "Create from encrypted backup",
          )}
        </Button>
      )}
      <p className="muted">
        {w(
          "加密保护锁定时的磁盘文件，不保护已解锁内存或手动导出的明文文件。",
          "加密保護鎖定時的磁碟檔案，不保護已解鎖記憶體或手動匯出的明文檔案。",
          "Encryption protects files at rest, not unlocked memory or plaintext exports.",
        )}
      </p>
    </div>
  );
}
