import { useEffect, useState } from "react";
import {
  aiAvailable,
  aiTransport,
  type AiConfig,
  type AiStatus,
} from "@/core/ai-transport";
import { aiError } from "@/core/ai-errors";
import { translator } from "@/i18n";
import type { Locale } from "@/core/model";
import type { Confirm } from "@/hooks/use-confirmation";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { Switch } from "./ui/switch";
export function AiSettings({
  locale,
  confirm,
}: {
  locale: Locale;
  confirm: Confirm;
}) {
  const t = translator(locale),
    [status, setStatus] = useState<AiStatus | null>(null),
    [config, setConfig] = useState<AiConfig | null>(null),
    [key, setKey] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [models, setModels] = useState<string[]>([]);
  const load = async () => {
    const s = await aiTransport.load();
    setStatus(s);
    setConfig(s.config);
    setKey("");
  };
  useEffect(() => {
    if (aiAvailable) void load().catch((e) => setMessage(aiError(e, t)));
    return () => {
      setKey("");
    };
  }, []);
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch (e) {
      setMessage(aiError(e, t));
    } finally {
      setBusy(false);
      setKey("");
    }
  };
  if (!aiAvailable) return <p>{t("aiDesktop")}</p>;
  if (!config)
    return (
      <div className="modal-stack">
        <p role="alert">{message}</p>
        <Button onClick={() => void run(load)}>{t("aiReload")}</Button>
      </div>
    );
  const patch = (next: Partial<AiConfig>) => setConfig({ ...config, ...next });
  return (
    <div className="modal-stack">
      <p>{t("aiPrivacy")}</p>
      <label className="settings-row">
        <b>{t("aiEnabled")}</b>
        <Switch
          checked={config.enabled}
          disabled={busy}
          aria-label={t("aiEnabled")}
          onCheckedChange={(enabled) => patch({ enabled })}
        />
      </label>
      <label>
        {t("aiProvider")}
        <select
          aria-label={t("aiProvider")}
          value={config.provider}
          disabled={busy}
          onChange={(e) => {
            const provider = e.target.value as AiConfig["provider"];
            patch({
              provider,
              model: provider === "deepseek" ? "deepseek-flash" : "",
            });
            setStatus(null);
            setKey("");
            setModels([]);
          }}
        >
          <option value="deepseek">DeepSeek</option>
          <option value="openai">OpenAI</option>
        </select>
      </label>
      <p className="data-path">
        {config.provider === "deepseek"
          ? "https://api.deepseek.com"
          : "https://api.openai.com"}
      </p>
      <label>
        {t("aiModel")}
        <Input
          aria-label={t("aiModel")}
          value={config.model}
          list="ai-model-list"
          maxLength={160}
          disabled={busy}
          onChange={(e) => patch({ model: e.target.value })}
        />
        <datalist id="ai-model-list">
          {models.map((id) => (
            <option key={id} value={id} />
          ))}
        </datalist>
      </label>
      <p>{t("aiModelHint")}</p>
      <label>
        {t("aiKey")}
        <Input
          aria-label={t("aiKey")}
          type="password"
          autoComplete="new-password"
          spellCheck={false}
          value={key}
          maxLength={2048}
          disabled={busy}
          onChange={(e) => setKey(e.target.value)}
        />
      </label>
      <p>{t("aiKeyHint")}</p>
      {status?.hasKey && status.config.provider === config.provider && (
        <p>{t("aiKeySaved")}</p>
      )}
      <div className="modal-actions">
        <Button
          variant="outline"
          disabled={busy || key.length < 16}
          onClick={() =>
            void run(async () => {
              await aiTransport.saveKey(config.provider, key);
              setStatus({ config, hasKey: true });
              setMessage(t("aiKeySaved"));
            })
          }
        >
          {t("aiSaveKey")}
        </Button>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              if (
                await confirm({
                  title: t("aiDeleteKey"),
                  description: config.provider,
                  danger: true,
                })
              ) {
                await aiTransport.deleteKey(config.provider);
                setStatus({ config, hasKey: false });
                setMessage(t("aiDeleteKey"));
              }
            })
          }
        >
          {t("aiDeleteKey")}
        </Button>
      </div>
      <Button
        variant="outline"
        disabled={busy}
        onClick={() =>
          void run(async () => {
            const ids = await aiTransport.models(config.provider);
            setModels(ids);
            setMessage(`${ids.length} · ${t("aiConnect")}`);
          })
        }
      >
        {t("aiConnect")}
      </Button>
      <p>{t("aiConnectHint")}</p>
      <label>
        {t("aiInputLimit")}
        <select
          aria-label={t("aiInputLimit")}
          value={config.maxInputChars}
          disabled={busy}
          onChange={(e) => patch({ maxInputChars: Number(e.target.value) })}
        >
          {[16000, 32000, 64000].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t("aiOutputLimit")}
        <select
          aria-label={t("aiOutputLimit")}
          value={config.maxOutputTokens}
          disabled={busy}
          onChange={(e) => patch({ maxOutputTokens: Number(e.target.value) })}
        >
          {[1024, 2048, 4096, 8192].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t("aiRounds")}
        <select
          aria-label={t("aiRounds")}
          value={config.maxRounds}
          disabled={busy}
          onChange={(e) => patch({ maxRounds: Number(e.target.value) })}
        >
          {[2, 3, 4].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <p>{t("aiCost")}</p>
      <Button
        disabled={busy || (config.enabled && !config.model.trim())}
        onClick={() =>
          void run(async () => {
            await aiTransport.save(config);
            await load();
            setMessage(t("aiSaved"));
          })
        }
      >
        {t("aiSaveConfig")}
      </Button>
      <p role="status" aria-live="polite">
        {message}
      </p>
    </div>
  );
}
