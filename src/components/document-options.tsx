import type { Confirm } from "@/hooks/use-confirmation";
import { useEffect, useState } from "react";
import { History, MoreHorizontal } from "lucide-react";
import type { Document, Library, Locale } from "@/core/model";
import { documentHistory, store } from "@/core/storage";
import type { HistoryEntry } from "@/core/history";
import { translator, formatTime } from "@/i18n";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";

export function DocumentOptions({
  doc,
  confirm,
  libraries,
  locale,
  patch,
  notify,
}: {
  doc: Document;
  confirm: Confirm;
  libraries: Library[];
  locale: Locale;
  patch: (id: string, value: Partial<Document>) => void;
  notify: (text: string) => void;
}) {
  const t = translator(locale),
    [open, setOpen] = useState(false),
    [entries, setEntries] = useState<HistoryEntry[]>([]),
    [chosen, setChosen] = useState<HistoryEntry | null>(null),
    [busy, setBusy] = useState(false),
    [failure, setFailure] = useState("");
  const [library, setLibrary] = useState(doc.libraryId),
    [tags, setTags] = useState(doc.tags.join(", "));
  useEffect(() => {
    if (open) {
      setLibrary(doc.libraryId);
      setTags(doc.tags.join(", "));
      setChosen(null);
      setBusy(true);
      setFailure("");
      void documentHistory(doc.id)
        .then(setEntries)
        .catch((e) => setFailure(String(e)))
        .finally(() => setBusy(false));
    }
  }, [open, doc.id]);
  const parsed = [
    ...new Set(
      tags
        .split(/[,，]/)
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  ];
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t("manageDocument")}
        title={t("manageDocument")}
        onClick={() => setOpen(true)}
      >
        <MoreHorizontal size={16} />
      </Button>
      <Dialog open={open} onOpenChange={(v) => !busy && setOpen(v)}>
        <DialogContent className="document-options" closeLabel={t("close")}>
          <DialogHeader>
            <DialogTitle>{t("manageDocument")}</DialogTitle>
            <DialogDescription>{doc.title}</DialogDescription>
          </DialogHeader>
          <section className="modal-stack">
            <h3>{t("editMetadata")}</h3>
            <label>
              {t("belongs")}
              <select
                className="full-select"
                aria-label={t("belongs")}
                value={library}
                onChange={(e) => setLibrary(e.target.value)}
                disabled={!!doc.deletedAt}
              >
                {libraries.map((l) => (
                  <option value={l.id} key={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("tags")}
              <Input
                aria-label={t("tags")}
                value={tags}
                placeholder={t("tagsHint")}
                onChange={(e) => setTags(e.target.value)}
                readOnly={!!doc.deletedAt}
              />
            </label>
            <Button
              disabled={
                !!doc.deletedAt ||
                parsed.length > 20 ||
                parsed.some((v) => v.length > 40) ||
                busy
              }
              onClick={async () => {
                if (
                  library !== doc.libraryId &&
                  !(await confirm({
                    title: t("confirmMove"),
                    description:
                      t("moveConfirmHint") +
                      " " +
                      libraries.find((l) => l.id === library)?.name,
                    names: [doc.title],
                  }))
                )
                  return;
                patch(doc.id, { libraryId: library, tags: parsed });
                setOpen(false);
                notify(t("saved"));
              }}
            >
              {t("save")}
            </Button>
          </section>
          <section className="modal-stack history-section">
            <h3>
              <History size={16} />
              {t("history")}
            </h3>
            <p className="muted">{t("historyHint")}</p>
            {failure && <p role="alert">{failure}</p>}
            {busy ? (
              <p role="status">{t("loading")}</p>
            ) : !entries.length ? (
              <p>{t("historyEmpty")}</p>
            ) : (
              <div className="history-list">
                {entries.map((e) => (
                  <button
                    key={e.id}
                    aria-pressed={chosen?.id === e.id}
                    onClick={() => setChosen(e)}
                  >
                    {formatTime(e.savedAt, locale)} · {e.document.title}{" "}
                    <small>
                      {e.document.body.length} {t("chars")}
                    </small>
                  </button>
                ))}
              </div>
            )}
            {chosen && (
              <>
                <pre className="history-preview">{chosen.document.body}</pre>
                <Button
                  disabled={busy || !!doc.deletedAt}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await store.restoreHistory(chosen);
                      setOpen(false);
                      notify(t("historyRestored"));
                    } catch (e) {
                      setFailure(String(e));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {t("restoreVersion")}
                </Button>
              </>
            )}
          </section>
        </DialogContent>
      </Dialog>
    </>
  );
}
