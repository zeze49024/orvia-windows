import { useRef, useState } from "react";

/** Serializes file/update jobs and owns their cancellation and progress lifetime. */
export function useJobRunner(onError: (error: unknown) => void) {
  const [busy, setBusy] = useState(false),
    [job, setJob] = useState("");
  const busyRef = useRef(false),
    cancelRef = useRef<AbortController | null>(null);
  const run = async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError"))
        onError(error);
    } finally {
      busyRef.current = false;
      setBusy(false);
      setJob("");
      cancelRef.current = null;
    }
  };
  return { busy, busyRef, job, setJob, cancelRef, run };
}
