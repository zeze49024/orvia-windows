import { useMemo, useEffect, useState, useRef, type RefObject } from "react";
import { documentOutline } from "@/core/editor";
import { translator } from "@/i18n";
import type { Locale } from "@/core/model";

export function DocumentOutline({
  body,
  locale,
  paper,
}: {
  body: string;
  locale: Locale;
  paper: RefObject<HTMLElement | null>;
}) {
  const headings = useMemo(() => documentOutline(body), [body]);
  const t = translator(locale),
    [active, setActive] = useState(-1),
    [mode, setMode] = useState(0),
    positions = useRef<number[]>([]);
  useEffect(() => {
    const article = paper.current,
      layout = article?.closest(".editor-layout");
    if (!article || !layout) return;
    const source = article.querySelector<HTMLTextAreaElement>(".source-editor");
    let frame = 0;
    const measure = () => {
      if (!source) return;
      if (!headings.length) {
        positions.current = [];
        return;
      }
      // A styled mirror measures wrapped lines, tabs and variable-width text exactly.
      const mirror = document.createElement("div"),
        style = getComputedStyle(source);
      for (const key of [
        "font",
        "fontFamily",
        "fontSize",
        "lineHeight",
        "letterSpacing",
        "padding",
        "border",
        "boxSizing",
        "tabSize",
        "overflowWrap",
        "wordBreak",
      ] as const)
        mirror.style[key] = style[key];
      Object.assign(mirror.style, {
        position: "absolute",
        visibility: "hidden",
        whiteSpace: "pre-wrap",
        width: source.clientWidth + "px",
        height: "auto",
        overflow: "visible",
      });
      let cursor = 0;
      const markers: HTMLSpanElement[] = [];
      headings.forEach((h) => {
        mirror.append(document.createTextNode(body.slice(cursor, h.offset)));
        const marker = document.createElement("span");
        marker.textContent = "\u200b";
        mirror.append(marker);
        markers.push(marker);
        cursor = h.offset;
      });
      // Only text preceding heading markers affects their positions. Laying out
      // a long tail after the final heading doubles textarea work on each edit.
      document.body.append(mirror);
      positions.current = markers.map((m) => m.offsetTop);
      mirror.remove();
    };
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (source) {
          let index = -1;
          for (let i = 0; i < positions.current.length; i++)
            if (positions.current[i] <= source.scrollTop + 40) index = i;
          if (source.scrollHeight - source.scrollTop - source.clientHeight < 3)
            index = headings.length - 1;
          setActive(index);
        } else {
          const top = layout.getBoundingClientRect().top + 90;
          let index = -1;
          article.querySelectorAll("h1,h2,h3,h4,h5,h6").forEach((h, i) => {
            if (h.getBoundingClientRect().top <= top) index = i;
          });
          setActive(index);
        }
      });
    };
    const select = () => {
      if (!source) return;
      let index = -1;
      headings.forEach((h, i) => {
        if (h.offset <= source.selectionStart) index = i;
      });
      setActive(index);
    };
    const mutation = new MutationObserver(() => {
      if (source !== article.querySelector(".source-editor"))
        setMode((v) => v + 1);
    });
    mutation.observe(article, { childList: true, subtree: true });
    measure();
    update();
    layout.addEventListener("scroll", update, { passive: true });
    source?.addEventListener("scroll", update, { passive: true });
    source?.addEventListener("select", select);
    const observer = new ResizeObserver(() => {
      measure();
      update();
    });
    observer.observe(article);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      mutation.disconnect();
      layout.removeEventListener("scroll", update);
      source?.removeEventListener("scroll", update);
      source?.removeEventListener("select", select);
    };
  }, [body, headings, paper, mode]);
  const navigate = (index: number) => {
    const source =
      paper.current?.querySelector<HTMLTextAreaElement>(".source-editor");
    if (source) {
      source.focus();
      const offset = headings[index].offset;
      source.setSelectionRange(offset, offset);
      source.scrollTop = Math.max(0, (positions.current[index] ?? 0) - 20);
      setActive(index);
      source.scrollIntoView({ block: "nearest" });
      return;
    }
    paper.current
      ?.querySelectorAll("h1,h2,h3,h4,h5,h6")
      [index]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return (
    <aside className="document-aside" aria-label={t("outline")}>
      <div className="aside-label">{t("outline")}</div>
      {headings.length ? (
        <nav aria-label={t("outline")}>
          {headings.map((heading, index) => (
            <button
              type="button"
              className="outline-item"
              aria-current={active === index}
              key={`${heading.offset}-${index}`}
              onClick={() => navigate(index)}
              style={{ paddingLeft: 12 + (heading.level - 1) * 12 }}
              title={heading.text}
            >
              {heading.text || t("untitledHeading")}
            </button>
          ))}
        </nav>
      ) : (
        <p className="outline-empty">{t("outlineEmpty")}</p>
      )}
    </aside>
  );
}
