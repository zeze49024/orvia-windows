import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  CornerDownLeft,
  FileText,
  History,
  Maximize2,
  MessageSquare,
  Minimize2,
  PanelRightClose,
  Pencil,
  Plus,
  Replace,
  ShieldCheck,
  Sparkles,
  Square,
  TextQuote,
  Trash2,
  X,
} from "lucide-react";
import {
  aiAvailable,
  aiTransport,
  type AiStatus,
  type AiRequest,
  type AiSnapshot,
} from "@/core/ai-transport";
import {
  aiSnapshot,
  assertCurrent,
  validateProposal,
  aiOutputSchema,
  applyAiProposal,
  lineDiff,
} from "@/core/ai";
import {
  conversationContext,
  conversationsSchema,
  type AiConversation,
  type AiScope,
  type ChatMessage,
  type AiAnchor,
} from "@/core/ai-history";
import type { AiEditorBridge, AiSelectionRequest } from "@/core/ai-editor";
import { aiError } from "@/core/ai-errors";
import { store } from "@/core/storage";
import { chatScrollBehavior } from "@/core/motion";
import { resolveTheme } from "@/core/themes";
import type { Document, Locale } from "@/core/model";
import type { Confirm } from "@/hooks/use-confirmation";
import { translator } from "@/i18n";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Card, CardHeader, CardContent, CardFooter } from "./ui/card";
import { Separator } from "./ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";

function IconButton({
  label,
  children,
  onClick,
  disabled = false,
}: {
  label: string;
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="ai-icon"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent sideOffset={6}>{label}</TooltipContent>
    </Tooltip>
  );
}
function SafeAnswer({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      skipHtml
      urlTransform={() => ""}
      components={{
        img: ({ alt }) => <span>[{alt || "image"}]</span>,
        a: ({ children }) => <span>{children}</span>,
      }}
    >
      {text}
    </ReactMarkdown>
  );
}
type Review = {
  base: AiSnapshot;
  proposal: { title: string; body: string };
  before: string;
  after: string;
  messageId: string;
  kind: "selection" | "note" | "insert";
};
export function AiPanel({
  doc,
  locale,
  confirm,
  notify,
  run,
  bridge,
  seed,
  expanded,
  onExpand,
  onClose,
  onConfigure,
}: {
  doc: Document;
  locale: Locale;
  confirm: Confirm;
  notify: (s: string) => void;
  run: (a: () => Promise<void>) => Promise<void>;
  bridge: () => AiEditorBridge | null;
  seed: AiSelectionRequest | null;
  expanded: boolean;
  onExpand: () => void;
  onClose: () => void;
  onConfigure: () => void;
}) {
  const t = translator(locale),
    space = useRef(store.vaultMode),
    alive = useRef(true),
    job = useRef<string | null>(null),
    timeline = useRef<HTMLDivElement>(null),
    input = useRef<HTMLTextAreaElement>(null);
  const sessions = store.data.settings.aiConversations
    .filter((c) => c.documentId === doc.id)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const [activeId, setActiveId] = useState(sessions[0]?.id || ""),
    [status, setStatus] = useState<AiStatus | null>(null),
    [draft, setDraft] = useState(""),
    [scope, setScope] = useState<AiScope>("note");
  const [anchor, setAnchor] = useState<AiAnchor | null>(null),
    [quoteOpen, setQuoteOpen] = useState(false),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [historyOpen, setHistoryOpen] = useState(false);
  const [review, setReview] = useState<Review | null>(null),
    [scopeOpen, setScopeOpen] = useState(false),
    [rename, setRename] = useState<{ id: string; title: string } | null>(null);
  const [models, setModels] = useState<string[]>([]),
    [modelsOpen, setModelsOpen] = useState(false),
    [modelsBusy, setModelsBusy] = useState(false);
  const anchorBody = useRef<string | null>(null);
  const session = sessions.find((c) => c.id === activeId),
    messages = session?.messages || [];
  const usable =
    status?.config.enabled &&
    status.hasKey &&
    status.authorized &&
    !!status.config.model;
  function ensureLive() {
    if (
      !alive.current ||
      space.current !== store.vaultMode ||
      !store.ready ||
      !store.data.documents.some((d) => d.id === doc.id && !d.deletedAt)
    )
      throw new Error("AI_CONFLICT");
  }
  function currentDoc() {
    ensureLive();
    return store.data.documents.find((d) => d.id === doc.id)!;
  }
  async function save(update: (items: AiConversation[]) => AiConversation[]) {
    ensureLive();
    let next: AiConversation[];
    try {
      next = conversationsSchema.parse(
        update(store.data.settings.aiConversations),
      );
    } catch {
      throw new Error("AI_HISTORY_LIMIT");
    }
    store.change((s) => ({
      ...s,
      settings: { ...s.settings, aiConversations: next },
    }));
    await store.flush();
  }
  const stop = () => {
    const id = job.current;
    job.current = null;
    setPending(false);
    if (id) void aiTransport.cancel(id).catch(() => {});
  };
  useEffect(() => {
    alive.current = true;
    if (aiAvailable)
      void aiTransport
        .load()
        .then((s) => {
          if (alive.current) setStatus(s);
        })
        .catch((e) => {
          if (alive.current) setError(aiError(e, t));
        });
    return () => {
      alive.current = false;
      if (job.current) void aiTransport.cancel(job.current).catch(() => {});
      job.current = null;
    };
  }, []);
  useEffect(() => {
    if (!seed) return;
    anchorBody.current = seed.body;
    stop();
    setReview(null);
    setAnchor(seed.anchor);
    setScope("selection");
    setQuoteOpen(false);
    setError("");
    const keys = {
      ask: null,
      polish: "aiPolishPrompt",
      expand: "aiExpandPrompt",
      summarize: "aiSummarizePrompt",
      translate: "aiTranslatePrompt",
    } as const;
    setDraft(keys[seed.action] ? t(keys[seed.action]!) : "");
    requestAnimationFrame(() => input.current?.focus());
  }, [seed?.serial]);
  useEffect(() => {
    timeline.current?.scrollTo({
      top: timeline.current.scrollHeight,
      behavior: chatScrollBehavior(),
    });
  }, [messages.length, pending, activeId]);
  useEffect(() => {
    if (input.current) {
      input.current.style.height = "72px";
      input.current.style.height = `${Math.min(160, Math.max(72, input.current.scrollHeight))}px`;
    }
  }, [draft]);
  useEffect(() => {
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (historyOpen || modelsOpen) {
          setHistoryOpen(false);
          setModelsOpen(false);
        } else if (!review && !scopeOpen && !rename) {
          stop();
          onClose();
        }
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [historyOpen, modelsOpen, review, scopeOpen, rename]);
  const fail = (e: unknown) => setError(aiError(e, t));
  async function newChat() {
    stop();
    setError("");
    try {
      const now = new Date().toISOString(),
        c: AiConversation = {
          id: crypto.randomUUID(),
          documentId: doc.id,
          title: t("aiChatNew"),
          createdAt: now,
          updatedAt: now,
          messages: [],
        };
      await save((s) => [c, ...s]);
      if (alive.current) {
        setActiveId(c.id);
        setDraft("");
        setHistoryOpen(false);
      }
    } catch (e) {
      fail(e);
    }
  }
  function choose(id: string) {
    stop();
    setReview(null);
    setError("");
    setDraft("");
    setActiveId(id);
    setHistoryOpen(false);
  }
  const sending = useRef(false);
  async function prepareSend() {
    if (pending || sending.current || !usable || !draft.trim()) return;
    sending.current = true;
    const preparedId = crypto.randomUUID();
    job.current = preparedId;
    setPending(true);
    setError("");
    try {
      const base = await aiSnapshot(currentDoc());
      if (!alive.current || job.current !== preparedId) return;
      assertCurrent(base);
      if (
        scope === "selection" &&
        (!anchor?.text.trim() || anchor.text.length > 64000)
      )
        throw new Error("AI_INPUT_LIMIT");
      if (scope === "selection") {
        if (anchorBody.current !== base.body) throw new Error("AI_CONFLICT");
        if (!bridge()) throw new Error("AI_CONFLICT");
        bridge()!.preview(anchor!, anchor!.text, "replace");
      }
      const snapshot = {
        ...base,
        title: scope === "none" ? "" : base.title,
        body:
          scope === "selection"
            ? anchor!.text
            : scope === "none"
              ? ""
              : base.body,
      };
      const cost = [...(snapshot.body + snapshot.title + draft.trim())].length;
      if (cost > status!.config.maxInputChars)
        throw new Error("AI_INPUT_LIMIT");
      const history = conversationContext(
        messages,
        status!.config.maxInputChars - cost,
      );
      await sendMessage({
        request: {
          id: preparedId,
          snapshot,
          task: draft.trim(),
          mode: scope === "none" ? "answer" : "edit",
          locale,
          scope,
          history,
        },
        base,
        anchor: scope === "selection" ? anchor : null,
        sessionId: session?.id || crypto.randomUUID(),
        historyTotal: messages.length,
      });
    } catch (e) {
      if (alive.current && job.current === preparedId) fail(e);
    } finally {
      sending.current = false;
      if (alive.current && job.current === preparedId) {
        job.current = null;
        setPending(false);
      }
    }
  }
  async function sendMessage(captured: {
    request: AiRequest;
    base: AiSnapshot;
    anchor: AiAnchor | null;
    sessionId: string;
    historyTotal: number;
  }) {
    const { request, base, sessionId } = captured;
    job.current = request.id;
    setPending(true);
    setError("");
    try {
      assertCurrent(base);
      if (messages.length > 78) throw new Error("AI_HISTORY_LIMIT");
      const now = new Date().toISOString(),
        user: ChatMessage = {
          id: crypto.randomUUID(),
          role: "user",
          content: request.task,
          quote:
            request.scope === "selection" ? request.snapshot.body : undefined,
          createdAt: now,
          scope: request.scope,
        };
      await save((items) => {
        const c = items.find((c) => c.id === sessionId);
        return c
          ? items.map((item) =>
              item.id === sessionId
                ? {
                    ...item,
                    updatedAt: now,
                    messages: [...item.messages, user],
                  }
                : item,
            )
          : [
              {
                id: sessionId,
                documentId: doc.id,
                title: request.task.slice(0, 60),
                createdAt: now,
                updatedAt: now,
                messages: [user],
              },
              ...items,
            ];
      });
      if (!alive.current || job.current !== request.id) return;
      setActiveId(sessionId);
      setDraft("");
      const output = aiOutputSchema.parse(await aiTransport.run(request));
      if (!alive.current || job.current !== request.id) return;
      assertCurrent(base);
      if (output.proposal) {
        if (request.scope === "none") throw new Error("AI_TOOL_DENIED");
        validateProposal(request.snapshot, output.proposal);
      }
      const reply: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: output.answer,
        createdAt: new Date().toISOString(),
        proposal: output.proposal ?? undefined,
        fingerprint: base.fingerprint,
        scope: request.scope,
        anchor: captured.anchor ?? undefined,
        usage: {
          input: output.inputTokens,
          output: output.outputTokens,
          requests: output.requests,
        },
      };
      await save((items) =>
        items.map((c) =>
          c.id === sessionId
            ? {
                ...c,
                updatedAt: reply.createdAt,
                messages: [...c.messages, reply],
              }
            : c,
        ),
      );
    } catch (e) {
      if (alive.current && job.current === request.id) fail(e);
    } finally {
      if (alive.current && job.current === request.id) {
        job.current = null;
        setPending(false);
      }
    }
  }
  async function prepareReview(m: ChatMessage, insert = false) {
    setError("");
    try {
      const base = await aiSnapshot(currentDoc());
      assertCurrent(base);
      const content = m.proposal?.body ?? m.content;
      let proposal: { title: string; body: string },
        before: string,
        kind: Review["kind"];
      if (insert) {
        const access = bridge();
        if (!access) throw new Error("AI_CONFLICT");
        const target = access.capture();
        proposal = {
          title: base.title,
          body: access.preview(target, content, "insert"),
        };
        before = "";
        kind = "insert";
      } else {
        if (!m.proposal || m.fingerprint !== base.fingerprint)
          throw new Error("AI_CONFLICT");
        if (m.scope === "selection") {
          if (!m.anchor || !bridge()) throw new Error("AI_CONFLICT");
          proposal = {
            title: base.title,
            body: bridge()!.preview(m.anchor, m.proposal.body, "replace"),
          };
          before = m.anchor.text;
          kind = "selection";
        } else {
          proposal = m.proposal;
          before = base.body;
          kind = "note";
        }
      }
      validateProposal(base, proposal);
      setReview({
        base,
        proposal,
        before,
        after: content,
        messageId: m.id,
        kind,
      });
    } catch (e) {
      fail(e);
    }
  }
  async function applyReview() {
    const r = review;
    if (!r) return;
    await run(async () => {
      try {
        ensureLive();
        await applyAiProposal(r.base, r.proposal);
        ensureLive();
        if (r.kind !== "insert")
          await save((items) =>
            items.map((c) => ({
              ...c,
              messages: c.messages.map((m) =>
                m.id === r.messageId ? { ...m, applied: true } : m,
              ),
            })),
          );
        setReview(null);
        notify(t("aiApplied"));
      } catch (e) {
        fail(e);
      }
    });
  }
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      notify(t("aiCopied"));
    } catch {
      notify(t("failed"));
    }
  }
  async function removeChat(id: string) {
    if (pending) return;
    if (
      await confirm({
        title: t("aiChatDelete"),
        description: t("aiChatDeleteHint"),
        names: [sessions.find((c) => c.id === id)?.title || ""],
        danger: true,
      })
    ) {
      try {
        await save((items) => items.filter((c) => c.id !== id));
        if (activeId === id) setActiveId("");
      } catch (e) {
        fail(e);
      }
    }
  }
  const diff = review ? lineDiff(review.before, review.after) : null;
  const scopeLabel =
    scope === "selection"
      ? t("aiSelection")
      : scope === "note"
        ? t("aiCurrentNote")
        : t("aiNoNote");
  const icon = (
    label: string,
    children: React.ReactNode,
    action: () => void,
    disabled = false,
  ) => (
    <IconButton label={label} onClick={action} disabled={disabled}>
      {children}
    </IconButton>
  );
  return (
    <TooltipProvider delayDuration={350}>
      <section className="ai-chat" aria-label={t("aiTitle")}>
        <header className="ai-chat-header">
          <div className="ai-chat-title">
            <Sparkles size={21} />
            <div>
              <strong>{t("aiTitle")}</strong>
              <small>{session?.title || t("aiChatNew")}</small>
            </div>
          </div>
          <div className="ai-header-actions">
            {icon(t("aiChatHistory"), <History />, () =>
              setHistoryOpen(!historyOpen),
            )}
            {icon(t("aiChatNew"), <Plus />, () => void newChat(), pending)}
            <Separator orientation="vertical" />
            {icon(
              t(expanded ? "aiCollapsePanel" : "aiExpandPanel"),
              expanded ? <Minimize2 /> : <Maximize2 />,
              onExpand,
            )}
            {icon(t("aiClosePanel"), <PanelRightClose />, () => {
              stop();
              onClose();
            })}
          </div>
        </header>
        <div className="ai-chat-context">
          <FileText size={14} />
          <span>{doc.title}</span>
          <Badge variant="outline">{t("aiSourceLabel")}</Badge>
        </div>
        {!aiAvailable ? (
          <p className="ai-setup">{t("aiDesktop")}</p>
        ) : !usable ? (
          <div className="ai-setup">
            <p>
              {t(
                status?.hasKey && !status.authorized
                  ? "aiAuthorizationRequired"
                  : "aiSetup",
              )}
            </p>
            <Button variant="outline" size="sm" onClick={onConfigure}>
              {t("aiConfigure")}
            </Button>
          </div>
        ) : null}
        {store.vaultMode === "private" && (
          <p className="ai-encrypted-warning">
            <ShieldCheck size={14} />
            {t("aiEncrypted")}
          </p>
        )}
        {(historyOpen || modelsOpen) && (
          <button
            className="ai-popover-dismiss"
            aria-label={t("close")}
            onClick={() => {
              setHistoryOpen(false);
              setModelsOpen(false);
            }}
          />
        )}
        {historyOpen && (
          <Card className="ai-history-popover">
            <CardHeader>
              <strong>{t("aiChatForNote")}</strong>
              {icon(t("aiChatNew"), <Plus />, () => void newChat(), pending)}
            </CardHeader>
            <CardContent>
              {sessions.length ? (
                sessions.map((c) => (
                  <div
                    className={`ai-session ${c.id === activeId ? "selected" : ""}`}
                    key={c.id}
                  >
                    <button onClick={() => choose(c.id)}>
                      <MessageSquare size={14} />
                      <span>{c.title}</span>
                    </button>
                    {icon(
                      t("aiChatRename") + " " + c.title,
                      <Pencil />,
                      () => setRename({ id: c.id, title: c.title }),
                      pending,
                    )}
                    {icon(
                      t("aiChatDelete") + " " + c.title,
                      <Trash2 />,
                      () => void removeChat(c.id),
                      pending,
                    )}
                  </div>
                ))
              ) : (
                <p>{t("aiNoMessages")}</p>
              )}
            </CardContent>
            <CardFooter>
              <ShieldCheck size={13} />
              {t(
                store.vaultMode === "private" ? "aiChatPrivate" : "aiChatLocal",
              )}
            </CardFooter>
          </Card>
        )}
        <div
          className="ai-chat-log"
          ref={timeline}
          role="log"
          aria-label={t("aiChatMessages")}
          aria-live="polite"
        >
          {!messages.length ? (
            <div className="ai-chat-empty">
              <Sparkles size={30} />
              <h2>{t("aiChatWelcome")}</h2>
              <p>{t("aiChatWelcomeHint")}</p>
              <div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setDraft(t("aiSummarizePrompt"));
                    input.current?.focus();
                  }}
                >
                  {t("aiSummarize")}
                  <ArrowUp size={13} />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setDraft(t("aiPolishPrompt"));
                    input.current?.focus();
                  }}
                >
                  {t("aiPolish")}
                  <ArrowUp size={13} />
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="ai-conversation-divider">
                <span />
                {t("aiConversation")}
                <span />
              </div>
              {messages.map((m) => (
                <div className={`ai-message ai-${m.role}`} key={m.id}>
                  {m.role === "user" ? (
                    <div className="ai-user-bubble">
                      {m.quote && (
                        <blockquote>
                          <TextQuote size={13} />
                          <p>{m.quote}</p>
                        </blockquote>
                      )}
                      <p>{m.content}</p>
                    </div>
                  ) : (
                    <>
                      <div className="ai-assistant-label">
                        <img
                          src={
                            resolveTheme(store.data.settings.theme)
                              .appearance === "dark"
                              ? "/brand/orvia-symbol-dark.svg"
                              : "/brand/orvia-symbol.svg"
                          }
                          alt=""
                        />
                        <strong>Orvia</strong>
                        <Badge variant="outline">AI</Badge>
                      </div>
                      <div className="ai-answer">
                        <SafeAnswer text={m.content} />
                      </div>
                      {m.proposal && (
                        <Card className="ai-proposal">
                          <CardHeader>
                            <div>
                              <Pencil size={14} />
                              {t("aiDraftLabel")}
                            </div>
                            <Badge variant="outline">
                              {m.applied ? (
                                <>
                                  <Check size={11} />
                                  {t("aiAppliedShort")}
                                </>
                              ) : (
                                t("aiPendingApproval")
                              )}
                            </Badge>
                          </CardHeader>
                          <CardContent>
                            <SafeAnswer text={m.proposal.body} />
                          </CardContent>
                          <CardFooter>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={m.applied || !m.fingerprint || pending}
                              onClick={() => void prepareReview(m)}
                            >
                              <Replace size={14} />
                              {m.applied
                                ? t("aiAppliedShort")
                                : !m.fingerprint
                                  ? t("aiOldProposal")
                                  : t("aiReview")}
                              <ChevronRight size={13} />
                            </Button>
                          </CardFooter>
                        </Card>
                      )}
                      <div className="ai-message-actions">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            void copy(m.proposal?.body ?? m.content)
                          }
                        >
                          <Copy size={14} />
                          {t("aiCopy")}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="ai-insert"
                          disabled={pending}
                          onClick={() => void prepareReview(m, true)}
                        >
                          <CornerDownLeft size={14} />
                          {t("aiInsert")}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={pending}
                          onClick={() => {
                            setDraft(t("aiFollowupPrompt"));
                            input.current?.focus();
                          }}
                        >
                          <MessageSquare size={14} />
                          {t("aiFollowup")}
                        </Button>
                      </div>
                      {m.usage && (
                        <details className="ai-usage">
                          <summary>{t("aiUsageShort")}</summary>
                          {m.usage.input} input / {m.usage.output} output ·{" "}
                          {m.usage.requests} requests
                        </details>
                      )}
                    </>
                  )}
                </div>
              ))}
            </>
          )}
          {pending && (
            <div className="ai-thinking">
              <Sparkles size={16} />
              {t("aiPending")}
              <i />
              <i />
              <i />
            </div>
          )}
        </div>
        <div className="ai-compose-zone">
          {error && (
            <p className="ai-chat-error" role="alert">
              {error}
            </p>
          )}
          <div className="ai-composer">
            {scope === "selection" && anchor && (
              <div
                className={`ai-selected-reference ${quoteOpen ? "expanded" : ""}`}
              >
                <button
                  aria-label={t("aiQuoteExpand")}
                  aria-expanded={quoteOpen}
                  onClick={() => setQuoteOpen(!quoteOpen)}
                >
                  <TextQuote size={13} />
                  <strong>{t("aiSelection")}</strong>
                  <span>
                    {anchor.text.length} {t("chars")}
                  </span>
                  <ChevronDown size={11} />
                </button>
                {icon(
                  t("aiQuoteRemove"),
                  <X />,
                  () => {
                    setAnchor(null);
                    setScope("none");
                    setQuoteOpen(false);
                  },
                  pending,
                )}
                <p>{anchor.text}</p>
              </div>
            )}
            <Textarea
              ref={input}
              aria-label={t("aiChatInput")}
              placeholder={t("aiChatPlaceholder")}
              value={draft}
              maxLength={4000}
              disabled={pending}
              rows={2}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  void prepareSend();
                }
              }}
            />
            <div className="ai-composer-bottom">
              {icon(
                t("aiScopeLabel"),
                <Plus />,
                () => setScopeOpen(true),
                pending,
              )}
              <Button
                variant="ghost"
                size="sm"
                className="ai-model-trigger"
                disabled={pending || !status}
                onClick={() => setModelsOpen(!modelsOpen)}
              >
                {status
                  ? `${status.config.provider === "deepseek" ? "DeepSeek" : "OpenAI"} · ${status.config.model}`
                  : "…"}
                <ChevronDown size={11} />
              </Button>
              <div />
              {icon(
                t(pending ? "aiStop" : "aiChatSend"),
                pending ? (
                  <Square size={12} fill="currentColor" />
                ) : (
                  <ArrowUp size={18} />
                ),
                pending
                  ? () => {
                      stop();
                      setError(t("aiCancelled"));
                    }
                  : () => void prepareSend(),
                !pending && (!usable || !draft.trim()),
              )}
            </div>
          </div>
          <div className="ai-composer-foot">
            <button onClick={() => setScopeOpen(true)}>
              <ShieldCheck size={12} />
              {scopeLabel} · {t("aiDirectSend")}
            </button>
            <span>{t("aiAccuracy")}</span>
          </div>
        </div>
        {modelsOpen && (
          <Card className="ai-model-popover">
            <CardHeader>
              <strong>{t("aiSelectModel")}</strong>
            </CardHeader>
            <CardContent>
              {[...new Set([status?.config.model || "", ...models])]
                .filter(Boolean)
                .map((id) => (
                  <button
                    key={id}
                    disabled={modelsBusy}
                    onClick={() =>
                      void (async () => {
                        try {
                          if (!status) return;
                          await aiTransport.save({
                            ...status.config,
                            model: id,
                          });
                          setStatus(await aiTransport.load());
                          setModelsOpen(false);
                        } catch (e) {
                          fail(e);
                        }
                      })()
                    }
                  >
                    {id}
                    {status?.config.model === id && <Check size={13} />}
                  </button>
                ))}
              <Button
                variant="ghost"
                size="sm"
                disabled={modelsBusy || !status}
                onClick={() =>
                  void (async () => {
                    if (!status) return;
                    setModelsBusy(true);
                    try {
                      setModels(
                        await aiTransport.models(status.config.provider),
                      );
                    } catch (e) {
                      fail(e);
                    } finally {
                      setModelsBusy(false);
                    }
                  })()
                }
              >
                {t("aiRefreshModels")}
              </Button>
              <Button variant="ghost" size="sm" onClick={onConfigure}>
                {t("aiConfigure")}
              </Button>
            </CardContent>
          </Card>
        )}
        <Dialog
          open={!!review}
          onOpenChange={(open) => {
            if (!open) setReview(null);
          }}
        >
          <DialogContent
            className="dialog ai-review-dialog"
            closeLabel={t("close")}
          >
            <DialogHeader>
              <DialogTitle>
                {t(
                  review?.kind === "selection"
                    ? "aiReplaceSelection"
                    : review?.kind === "insert"
                      ? "aiInsertConfirm"
                      : "aiReplaceNote",
                )}
              </DialogTitle>
              <DialogDescription>{t("aiApplyConfirm")}</DialogDescription>
            </DialogHeader>
            {review && diff && (
              <>
                {review.kind === "note" &&
                  review.base.title !== review.proposal.title && (
                    <p className="ai-title-change">
                      {t("filename")}: {review.base.title} →{" "}
                      {review.proposal.title}
                    </p>
                  )}
                <div className="ai-diff">
                  <section>
                    <h4>{t("aiBefore")}</h4>
                    <pre>{diff.removed || "∅"}</pre>
                  </section>
                  <section>
                    <h4>{t("aiAfter")}</h4>
                    <pre>{diff.added || "∅"}</pre>
                  </section>
                </div>
                <details>
                  <summary>{t("aiFullText")}</summary>
                  <div className="ai-diff">
                    <pre>{review.before}</pre>
                    <pre>{review.after}</pre>
                  </div>
                </details>
                {error && (
                  <p className="ai-chat-error" role="alert">
                    {error}
                  </p>
                )}
                <div className="modal-actions">
                  <Button variant="outline" onClick={() => setReview(null)}>
                    {t("cancel")}
                  </Button>
                  <Button onClick={() => void applyReview()}>
                    {t(
                      review.kind === "selection"
                        ? "aiReplaceSelection"
                        : review.kind === "insert"
                          ? "aiInsertConfirm"
                          : "aiReplaceNote",
                    )}
                  </Button>
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>
        <Dialog open={scopeOpen} onOpenChange={setScopeOpen}>
          <DialogContent className="dialog" closeLabel={t("close")}>
            <DialogHeader>
              <DialogTitle>{t("aiScopeLabel")}</DialogTitle>
              <DialogDescription>{t("aiContextHint")}</DialogDescription>
            </DialogHeader>
            <select
              aria-label={t("aiScopeLabel")}
              value={scope}
              onChange={(e) => setScope(e.target.value as AiScope)}
            >
              <option value="selection" disabled={!anchor}>
                {t("aiSelection")}
              </option>
              <option value="note">{t("aiCurrentNote")}</option>
              <option value="none">{t("aiNoNote")}</option>
            </select>
            <p>{t("aiChatLocal")}</p>
            <Button variant="outline" onClick={() => setScopeOpen(false)}>
              {t("close")}
            </Button>
          </DialogContent>
        </Dialog>
        <Dialog
          open={!!rename}
          onOpenChange={(open) => {
            if (!open) setRename(null);
          }}
        >
          <DialogContent className="dialog" closeLabel={t("close")}>
            <DialogHeader>
              <DialogTitle>{t("aiChatRename")}</DialogTitle>
              <DialogDescription>{t("aiRenameHint")}</DialogDescription>
            </DialogHeader>
            <Input
              aria-label={t("aiRenameHint")}
              maxLength={100}
              value={rename?.title || ""}
              onChange={(e) =>
                setRename((r) => (r ? { ...r, title: e.target.value } : null))
              }
            />
            <Button
              disabled={!rename?.title.trim()}
              onClick={() =>
                void (async () => {
                  try {
                    if (!rename) return;
                    await save((items) =>
                      items.map((c) =>
                        c.id === rename.id
                          ? { ...c, title: rename.title.trim() }
                          : c,
                      ),
                    );
                    setRename(null);
                  } catch (e) {
                    fail(e);
                  }
                })()
              }
            >
              {t("confirm")}
            </Button>
          </DialogContent>
        </Dialog>
      </section>
    </TooltipProvider>
  );
}
