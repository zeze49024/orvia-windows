import { memo, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowUp,
  ArrowDown,
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
import { translator, formatTime } from "@/i18n";
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
function CodeBlock({
  children,
  locale,
}: {
  children: React.ReactNode;
  locale: Locale;
}) {
  const t = translator(locale);
  const [copied, setCopied] = useState(false);
  const block = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <div className="ai-code-block">
      <div>
        <span>{t("aiCode")}</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            void navigator.clipboard
              .writeText(block.current?.textContent || "")
              .then(() => setCopied(true))
              .catch(() => setCopied(false));
          }}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {t(copied ? "aiCopied" : "aiCopyCode")}
        </Button>
      </div>
      <pre ref={block}>{children}</pre>
    </div>
  );
}
const SafeAnswer = memo(function SafeAnswer({
  text,
  locale,
}: {
  text: string;
  locale: Locale;
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      skipHtml
      urlTransform={() => ""}
      components={{
        pre: ({ children }) => (
          <CodeBlock locale={locale}>{children}</CodeBlock>
        ),
        img: ({ alt }) => <span>[{alt || "image"}]</span>,
        a: ({ children }) => <span>{children}</span>,
      }}
    >
      {text}
    </ReactMarkdown>
  );
});
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
  const [historyQuery, setHistoryQuery] = useState("");
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const [notice, setNotice] = useState("");
  const [copiedMessage, setCopiedMessage] = useState("");
  const [failedTask, setFailedTask] = useState("");
  const followBottom = useRef(true);
  const drafts = useRef(new Map<string, string>());
  const draftRef = useRef(draft);
  draftRef.current = draft;
  function scrollToLatest(behavior: ScrollBehavior = chatScrollBehavior()) {
    followBottom.current = true;
    setAwayFromBottom(false);
    timeline.current?.scrollTo({
      top: timeline.current.scrollHeight,
      behavior,
    });
  }
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
    const focusFrame = requestAnimationFrame(() => input.current?.focus());
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
      cancelAnimationFrame(focusFrame);
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
    if (followBottom.current) scrollToLatest();
  }, [messages.length, pending]);
  useEffect(() => {
    scrollToLatest("auto");
  }, [activeId]);
  useEffect(() => {
    if (!copiedMessage) return;
    const timer = setTimeout(() => setCopiedMessage(""), 2000);
    return () => clearTimeout(timer);
  }, [copiedMessage]);
  useEffect(() => {
    if (input.current) {
      input.current.style.height = "72px";
      input.current.style.height = `${Math.min(160, Math.max(72, input.current.scrollHeight))}px`;
    }
  }, [draft]);
  useEffect(() => {
    const close = (e: KeyboardEvent) => {
      if (
        e.defaultPrevented ||
        (e.target instanceof Element &&
          e.target.closest('[role="dialog"], [role="alertdialog"]'))
      )
        return;
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
    setReview(null);
    setError("");
    setFailedTask("");
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
        drafts.current.set(activeId, draftRef.current);
        setActiveId(c.id);
        setDraft("");
        setHistoryOpen(false);
        setNotice("");
        requestAnimationFrame(() => input.current?.focus());
      }
    } catch (e) {
      fail(e);
    }
  }
  function choose(id: string) {
    if (id === activeId) {
      setHistoryOpen(false);
      return;
    }
    drafts.current.set(activeId, draftRef.current);
    stop();
    setReview(null);
    setError("");
    setDraft(drafts.current.get(id) || "");
    setActiveId(id);
    setHistoryOpen(false);
    setNotice("");
    setFailedTask("");
    requestAnimationFrame(() => input.current?.focus());
  }
  async function prepareSend() {
    if (pending || job.current || !usable || !draft.trim()) return;
    const preparedId = crypto.randomUUID();
    job.current = preparedId;
    setPending(true);
    setError("");
    setNotice("");
    setFailedTask("");
    followBottom.current = true;
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
      drafts.current.delete(sessionId);
      setDraft((current) => (current.trim() === request.task ? "" : current));
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
      if (alive.current && job.current === request.id) {
        setFailedTask(request.task);
        fail(e);
      }
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
  async function copy(text: string, id: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMessage(id);
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
        drafts.current.delete(id);
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
            {icon(t("aiChatHistory"), <History />, () => {
              setModelsOpen(false);
              setHistoryQuery("");
              setHistoryOpen(!historyOpen);
            })}
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
        <button
          className="ai-chat-context"
          onClick={() => setScopeOpen(true)}
          disabled={pending}
          aria-label={`${t("aiScopeLabel")}: ${scopeLabel}`}
        >
          {scope === "selection" ? (
            <TextQuote size={14} />
          ) : scope === "none" ? (
            <MessageSquare size={14} />
          ) : (
            <FileText size={14} />
          )}
          <span title={scope === "note" ? doc.title : scopeLabel}>
            {scope === "note" ? doc.title : scopeLabel}
          </span>
          <Badge variant="outline">
            {scope === "none"
              ? t("aiNoAttachment")
              : scope === "selection"
                ? `${anchor?.text.length || 0} ${t("chars")}`
                : scopeLabel}
          </Badge>
          <ChevronDown size={12} />
        </button>
        {!aiAvailable ? (
          <p className="ai-setup">{t("aiDesktop")}</p>
        ) : !status && !error ? (
          <p className="ai-setup" role="status">
            {t("aiLoadingConfig")}
          </p>
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
              <Input
                aria-label={t("aiSearchChats")}
                placeholder={t("aiSearchChats")}
                value={historyQuery}
                onChange={(e) => setHistoryQuery(e.target.value)}
                className="ai-history-search"
                autoFocus
              />
              {sessions.filter((c) =>
                c.title
                  .toLocaleLowerCase()
                  .includes(historyQuery.trim().toLocaleLowerCase()),
              ).length ? (
                sessions
                  .filter((c) =>
                    c.title
                      .toLocaleLowerCase()
                      .includes(historyQuery.trim().toLocaleLowerCase()),
                  )
                  .map((c) => (
                    <div
                      className={`ai-session ${c.id === activeId ? "selected" : ""}`}
                      key={c.id}
                    >
                      <button
                        onClick={() => choose(c.id)}
                        aria-current={c.id === activeId ? "true" : undefined}
                      >
                        <MessageSquare size={14} />
                        <span>
                          <strong>{c.title}</strong>
                          <small>
                            {formatTime(c.updatedAt, locale)} ·{" "}
                            {c.messages.length} {t("aiMessageCount")}
                          </small>
                        </span>
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
                <p>{t(historyQuery ? "aiNoChatResults" : "aiNoMessages")}</p>
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
        <div className="ai-log-region">
          <div
            className="ai-chat-log"
            ref={timeline}
            role="log"
            aria-label={t("aiChatMessages")}
            aria-live="polite"
            aria-busy={pending}
            onScroll={(e) => {
              const el = e.currentTarget;
              const away =
                el.scrollHeight - el.scrollTop - el.clientHeight > 90;
              followBottom.current = !away;
              setAwayFromBottom(away);
            }}
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
                      setDraft(
                        t(
                          scope === "none"
                            ? "aiBrainstormPrompt"
                            : "aiSummarizePrompt",
                        ),
                      );
                      input.current?.focus();
                    }}
                  >
                    {t(
                      scope === "none"
                        ? "aiBrainstorm"
                        : scope === "selection"
                          ? "aiSummarizeSelection"
                          : "aiSummarize",
                    )}
                    <ArrowUp size={13} />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setDraft(
                        t(
                          scope === "none"
                            ? "aiOutlinePrompt"
                            : "aiPolishPrompt",
                        ),
                      );
                      input.current?.focus();
                    }}
                  >
                    {t(scope === "none" ? "aiOutline" : "aiPolish")}
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
                          <SafeAnswer text={m.content} locale={locale} />
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
                              <SafeAnswer
                                text={m.proposal.body}
                                locale={locale}
                              />
                            </CardContent>
                            <CardFooter>
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={
                                  m.applied || !m.fingerprint || pending
                                }
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
                              void copy(m.proposal?.body ?? m.content, m.id)
                            }
                          >
                            {copiedMessage === m.id ? (
                              <Check size={14} />
                            ) : (
                              <Copy size={14} />
                            )}
                            {t(copiedMessage === m.id ? "aiCopied" : "aiCopy")}
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
          {awayFromBottom && messages.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="ai-jump-latest"
              onClick={() => scrollToLatest("instant" as ScrollBehavior)}
            >
              <ArrowDown size={14} />
              {t("aiJumpLatest")}
            </Button>
          )}
        </div>
        <div className="ai-compose-zone">
          {notice && !error && (
            <p className="ai-chat-notice" role="status">
              {notice}
            </p>
          )}
          {error && (
            <div className="ai-chat-error" role="alert">
              <p>{error}</p>
              {failedTask && !draft.trim() && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setDraft(failedTask);
                    setError("");
                    setFailedTask("");
                    input.current?.focus();
                  }}
                >
                  {t("aiRestorePrompt")}
                </Button>
              )}
            </div>
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
              rows={2}
              aria-describedby="ai-input-hint"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing &&
                  e.keyCode !== 229
                ) {
                  e.preventDefault();
                  if (!pending) void prepareSend();
                }
              }}
            />
            <div className="ai-input-hint" id="ai-input-hint">
              <span>{t(pending ? "aiDraftWhileWaiting" : "aiSendHint")}</span>
              <span>{draft.length} / 4000</span>
            </div>
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
                onClick={() => {
                  setHistoryOpen(false);
                  setModelsOpen(!modelsOpen);
                }}
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
                      setNotice(t("aiStoppedHint"));
                    }
                  : () => void prepareSend(),
                !pending && (!usable || !draft.trim()),
              )}
            </div>
          </div>
          <div className="ai-composer-foot">
            <button disabled={pending} onClick={() => setScopeOpen(true)}>
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
