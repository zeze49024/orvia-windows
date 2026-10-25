import { useState } from "react";
import { store } from "@/core/storage";
import { translator } from "@/i18n";
import type { Locale } from "@/core/model";
import type { Confirm } from "@/hooks/use-confirmation";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
export function RecoveryNotice({
  locale,
  notify,
  confirm,
  onOpen,
}: {
  locale: Locale;
  notify: (s: string) => void;
  confirm: Confirm;
  onOpen: (id: string) => void;
}) {
  const t = translator(locale),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false);
  const docs = store.recoverable;
  if (!docs.length) return null;
  return (
    <>
      <div className="recovery-notice" role="status">
        <span>
          {t("recoveryFound")} · {docs.length}
        </span>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          {t("reviewDrafts")}
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="recovery-dialog">
          <DialogHeader>
            <DialogTitle>{t("reviewDrafts")}</DialogTitle>
            <DialogDescription>{t("recoveryHint")}</DialogDescription>
          </DialogHeader>
          <div className="recovery-list">
            {docs.map((doc) => (
              <details key={doc.id}>
                <summary>{doc.title || t("untitled")}</summary>
                <pre>{doc.body.slice(0, 12000)}</pre>
              </details>
            ))}
          </div>
          <div className="modal-actions">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              {t("later")}
            </Button>
            <Button
              variant="outline"
              className="action-danger"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  if (
                    await confirm({
                      title: t("discardDrafts"),
                      description: t("discardDraftsHint"),
                      names: docs.map((d) => d.title),
                      danger: true,
                    })
                  ) {
                    await store.discardDrafts();
                    setOpen(false);
                  }
                } catch (e) {
                  notify(String(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t("discardDrafts")}
            </Button>
            <Button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const ids = await store.recoverDrafts(t("recoveredSuffix"));
                  setOpen(false);
                  notify(t("draftsRecovered"));
                  if (ids[0]) onOpen(ids[0]);
                } catch (e) {
                  notify(String(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t("recoverCopies")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
