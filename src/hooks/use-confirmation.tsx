import { useEffect, useRef, useState } from "react";
import { AlertDialog } from "radix-ui";
import { Button } from "@/components/ui/button";
import type { Locale } from "@/core/model";
import { translator } from "@/i18n";
export type Confirmation = {
  title: string;
  description: string;
  names?: string[];
  danger?: boolean;
};
export type Confirm = (request: Confirmation) => Promise<boolean>;

export function useConfirmation(locale: Locale) {
  const [request, setRequest] = useState<Confirmation | null>(null);
  const resolver = useRef<((approved: boolean) => void) | null>(null);
  const finish = (approved: boolean) => {
    resolver.current?.(approved);
    resolver.current = null;
    setRequest(null);
  };
  useEffect(
    () => () => {
      resolver.current?.(false);
      resolver.current = null;
    },
    [],
  );
  const confirm: Confirm = (request) => {
    if (resolver.current) return Promise.resolve(false);
    setRequest(request);
    return new Promise((resolve) => {
      resolver.current = resolve;
    });
  };
  const t = translator(locale);
  const confirmationDialog = (
    <AlertDialog.Root
      open={!!request}
      onOpenChange={(open) => !open && finish(false)}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="confirmation-overlay" />
        <AlertDialog.Content className="confirmation-dialog">
          <AlertDialog.Title>{request?.title}</AlertDialog.Title>
          <AlertDialog.Description>
            {request?.description}
          </AlertDialog.Description>
          {!!request?.names?.length && (
            <p className="confirmation-count">
              {t("selectedCount")} {request.names.length}
            </p>
          )}
          {!!request?.names?.length && (
            <ul>
              {request.names.slice(0, 5).map((name, i) => (
                <li key={i}>{name || t("untitledHeading")}</li>
              ))}
              {request.names.length > 5 && <li>… {request.names.length}</li>}
            </ul>
          )}
          <div className="modal-actions">
            <AlertDialog.Cancel asChild>
              <Button variant="outline" onClick={() => finish(false)}>
                {t("cancel")}
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Button
                variant={request?.danger ? "destructive" : "default"}
                onClick={() => finish(true)}
              >
                {t("confirm")}
              </Button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
  return { confirm, confirmationDialog };
}
