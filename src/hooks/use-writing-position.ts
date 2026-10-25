import { useEffect, useRef, type RefObject } from "react";
import type { Editor } from "@tiptap/react";
import {
  readPosition,
  savePosition,
  type WritingPosition,
} from "@/core/writing-position";

export function useWritingPosition(
  id: string,
  editor: Editor | null,
  source: boolean,
  textarea: RefObject<HTMLTextAreaElement | null>,
  root: RefObject<HTMLDivElement | null>,
  initial?: WritingPosition,
) {
  const position = useRef<WritingPosition>(
    initial ??
      readPosition(id) ?? {
        mode: "rich",
        rich: { from: 1, to: 1 },
        source: { from: 0, to: 0, scroll: 0 },
        scroll: 0,
      },
  );
  useEffect(() => {
    if (!editor || !root.current) return;
    const layout = root.current.closest<HTMLElement>(".editor-layout");
    if (!layout) return;
    const area = textarea.current;
    position.current.mode = source ? "source" : "rich";
    let restoring = true,
      frame = 0,
      timer: ReturnType<typeof setTimeout> | undefined;
    const capture = () => {
      if (restoring || !layout.clientHeight) return;
      position.current.mode = source ? "source" : "rich";
      position.current.scroll = layout.scrollTop;
      if (source && area)
        position.current.source = {
          from: area.selectionStart,
          to: area.selectionEnd,
          scroll: area.scrollTop,
        };
      else if (!editor.isDestroyed)
        position.current.rich = {
          from: editor.state.selection.from,
          to: editor.state.selection.to,
        };
      clearTimeout(timer);
      timer = setTimeout(() => savePosition(id, position.current), 120);
    };
    const restore = () => {
      const p = position.current;
      if (source && area) {
        area.setSelectionRange(
          Math.min(p.source.from, area.value.length),
          Math.min(p.source.to, area.value.length),
        );
        area.scrollTop = p.source.scroll;
      } else if (!editor.isDestroyed) {
        const limit = editor.state.doc.content.size;
        editor.commands.setTextSelection({
          from: Math.min(p.rich.from, limit),
          to: Math.min(p.rich.to, limit),
        });
      }
      layout.scrollTop = p.scroll;
    };
    frame = requestAnimationFrame(() => {
      restore();
      frame = requestAnimationFrame(() => {
        restoring = false;
      });
    });
    const workspace = layout.closest(".workspace-content");
    const observer = new MutationObserver(() => {
      if (workspace?.hasAttribute("hidden")) {
        savePosition(id, position.current);
        return;
      }
      frame = requestAnimationFrame(() => {
        layout.scrollTop = position.current.scroll;
      });
    });
    if (workspace)
      observer.observe(workspace, {
        attributes: true,
        attributeFilter: ["hidden"],
      });
    editor.on("selectionUpdate", capture);
    layout.addEventListener("scroll", capture);
    area?.addEventListener("scroll", capture);
    area?.addEventListener("select", capture);
    const pageHide = () => savePosition(id, position.current);
    window.addEventListener("pagehide", pageHide);
    return () => {
      capture();
      clearTimeout(timer);
      savePosition(id, position.current);
      cancelAnimationFrame(frame);
      observer.disconnect();
      editor.off("selectionUpdate", capture);
      layout.removeEventListener("scroll", capture);
      area?.removeEventListener("scroll", capture);
      area?.removeEventListener("select", capture);
      window.removeEventListener("pagehide", pageHide);
    };
  }, [id, editor, source]);
}
