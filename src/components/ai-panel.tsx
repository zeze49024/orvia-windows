import { useEffect, useRef, useState } from "react";
import {
  aiAvailable,
  aiTransport,
  type AiStatus,
  type AiSnapshot,
  type AiOutput,
} from "@/core/ai-transport";
import {
  aiSnapshot,
  assertCurrent,
  validateProposal,
  aiOutputSchema,
  applyAiProposal,
  lineDiff,
} from "@/core/ai";
import { aiError } from "@/core/ai-errors";
import { store } from "@/core/storage";
import type { Document, Locale } from "@/core/model";
import type { Confirm } from "@/hooks/use-confirmation";
import { translator } from "@/i18n";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
export function AiPanel({
  doc,
  locale,
  confirm,
  notify,
  run,
}: {
  doc: Document;
  locale: Locale;
  confirm: Confirm;
  notify: (s: string) => void;
  run: (a: () => Promise<void>) => Promise<void>;
}) {
  const t = translator(locale),
    [status, setStatus] = useState<AiStatus | null>(null),
    [task, setTask] = useState(""),
    [mode, setMode] = useState<"answer" | "edit">("answer"),
    [consent, setConsent] = useState(false),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState<AiOutput | null>(null),
    [base, setBase] = useState<AiSnapshot | null>(null),
    [applied, setApplied] = useState(false),
    [applying, setApplying] = useState(false);
  const job = useRef<string | null>(null),
    live = useRef(true);
  useEffect(() => {
    live.current = true;
    if (aiAvailable)
      void aiTransport
        .load()
        .then((s) => {
          if (live.current) setStatus(s);
        })
        .catch((e) => {
          if (live.current) setError(aiError(e, t));
        });
    return () => {
      live.current = false;
      if (job.current) void aiTransport.cancel(job.current).catch(() => {});
      job.current = null;
    };
  }, []);
  const send = async () => {
    if (pending || !consent || !status?.config.enabled) return;
    const id = crypto.randomUUID();
    job.current = id;
    setPending(true);
    setResult(null);
    setBase(null);
    setApplied(false);
    setError("");
    try {
      const captured = await aiSnapshot(doc);
      assertCurrent(captured);
      if (captured.body.length + task.length > status.config.maxInputChars)
        throw new Error("AI_INPUT_LIMIT");
      if (!live.current || job.current !== id) return;
      const output = aiOutputSchema.parse(
        await aiTransport.run({ id, snapshot: captured, task, mode, locale }),
      );
      if (!live.current || job.current !== id) return;
      assertCurrent(captured);
      if (output.proposal) {
        if (mode !== "edit") throw new Error("AI_TOOL_DENIED");
        validateProposal(captured, output.proposal);
      }
      setBase(captured);
      setResult(output);
    } catch (e) {
      if (live.current && job.current === id) setError(aiError(e, t));
    } finally {
      if (live.current && job.current === id) {
        job.current = null;
        setPending(false);
      }
    }
  };
  const stop = () => {
    const id = job.current;
    job.current = null;
    setPending(false);
    setError(t("aiCancelled"));
    if (id) void aiTransport.cancel(id).catch(() => {});
  };
  if (!aiAvailable) return <p>{t("aiDesktop")}</p>;
  const enabled =
    status?.config.enabled && status.hasKey && status.config.model;
  const diff =
    result?.proposal && base ? lineDiff(base.body, result.proposal.body) : null;
  return (
    <div className="ai-panel">
      <p>{t("aiScope")}</p>
      {store.vaultMode === "private" && (
        <p className="ai-private-warning">{t("aiEncrypted")}</p>
      )}
      <p className="muted">{t("aiSession")}</p>
      <p>
        {status ? `${status.config.provider} · ${status.config.model}` : ""}
      </p>
      {!enabled && <p role="status">{t("aiSetup")}</p>}
      <div className="ai-mode">
        <label>
          <input
            type="radio"
            name="ai-mode"
            checked={mode === "answer"}
            disabled={pending}
            onChange={() => setMode("answer")}
          />
          {t("aiAnswerMode")}
        </label>
        <label>
          <input
            type="radio"
            name="ai-mode"
            checked={mode === "edit"}
            disabled={pending}
            onChange={() => setMode("edit")}
          />
          {t("aiEditMode")}
        </label>
      </div>
      <div className="ai-quick-actions">
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => {
            setMode("answer");
            setTask(t("aiSummarize"));
          }}
        >
          {t("aiSummarize")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => {
            setMode("edit");
            setTask(t("aiPolish"));
          }}
        >
          {t("aiPolish")}
        </Button>
      </div>
      <label>
        {t("aiInstruction")}
        <textarea
          aria-label={t("aiInstruction")}
          rows={3}
          maxLength={4000}
          placeholder={t("aiPromptHint")}
          disabled={pending}
          value={task}
          onChange={(e) => setTask(e.target.value)}
        />
      </label>
      <label className="ai-consent">
        <input
          type="checkbox"
          checked={consent}
          disabled={pending}
          onChange={(e) => setConsent(e.target.checked)}
        />
        {t("aiConsent")}
      </label>
      <div className="modal-actions">
        {pending ? (
          <Button variant="outline" onClick={stop}>
            {t("aiStop")}
          </Button>
        ) : (
          <Button
            disabled={!enabled || !consent || !task.trim() || applying}
            onClick={() => void send()}
          >
            {t("aiSend")}
          </Button>
        )}
      </div>
      {pending && (
        <p role="status" aria-live="polite">
          {t("aiPending")}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {result && (
        <section aria-label={t("aiResult")}>
          <h3>{t("aiResult")}</h3>
          {result.answer && <div className="ai-answer">{result.answer}</div>}
          <p className="muted">
            {t("aiUsage")} · {result.inputTokens} input / {result.outputTokens}{" "}
            output · {result.requests} requests
          </p>
          {result.proposal && base && diff && (
            <>
              <div className="ai-diff">
                <section>
                  <h4>{t("aiBefore")}</h4>
                  <b>{base.title}</b>
                  <pre>{diff.removed || "∅"}</pre>
                </section>
                <section>
                  <h4>{t("aiAfter")}</h4>
                  <b>{result.proposal.title}</b>
                  <pre>{diff.added || "∅"}</pre>
                </section>
              </div>
              <details>
                <summary>{t("aiFullText")}</summary>
                <div className="ai-diff">
                  <pre>{base.body}</pre>
                  <pre>{result.proposal.body}</pre>
                </div>
              </details>
              <p>{t("aiApplyConfirm")}</p>
              <Button
                disabled={applied || applying || pending}
                onClick={() => {
                  if (applying) return;
                  setApplying(true);
                  void run(async () => {
                    try {
                      assertCurrent(base);
                      if (
                        await confirm({
                          title: t("aiApply"),
                          description: t("aiApplyConfirm"),
                          names: [base.title],
                        })
                      ) {
                        await applyAiProposal(base, result.proposal!);
                        setApplied(true);
                        notify(t("aiApplied"));
                      }
                    } catch (e) {
                      setError(aiError(e, t));
                    } finally {
                      if (live.current) setApplying(false);
                    }
                  }).finally(() => {
                    if (live.current) setApplying(false);
                  });
                }}
              >
                {t(applied ? "aiApplied" : "aiApply")}
              </Button>
            </>
          )}
        </section>
      )}
    </div>
  );
}
