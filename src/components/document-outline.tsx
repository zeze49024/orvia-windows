import { useMemo, type RefObject } from "react";
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
  const t = translator(locale);
  const navigate = (index: number) => {
    const source =
      paper.current?.querySelector<HTMLTextAreaElement>(".source-editor");
    if (source) {
      source.focus();
      const offset = headings[index].offset;
      source.setSelectionRange(offset, offset);
      source.scrollTop =
        (source.scrollHeight * offset) / Math.max(1, body.length);
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
