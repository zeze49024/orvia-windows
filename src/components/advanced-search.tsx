import { useState } from "react";
import { store } from "@/core/storage";
import { searchNotes, words, type SearchFilters } from "@/core/productivity";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
export function AdvancedSearch({
  query,
  setQuery,
  open,
}: {
  query: string;
  setQuery: (v: string) => void;
  open: (id: string, query: string) => void;
}) {
  const w = (a: string, b: string, c: string) =>
    words(store.data.settings.locale, a, b, c);
  const [filters, setFilters] = useState<Omit<SearchFilters, "query">>({
      field: "all",
      library: "",
      starred: false,
      after: "",
      before: "",
    }),
    [limit, setLimit] = useState(50);
  const hits = searchNotes(store.data, { ...filters, query });
  return (
    <div className="modal-stack">
      <Input
        autoFocus
        aria-label={w("搜索", "搜尋", "Search")}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setLimit(50);
        }}
      />
      <div className="search-filters">
        <select
          aria-label={w("搜索范围", "搜尋範圍", "Search field")}
          value={filters.field}
          onChange={(e) =>
            setFilters({
              ...filters,
              field: e.target.value as SearchFilters["field"],
            })
          }
        >
          {(["all", "title", "body", "tags"] as const).map((key, i) => (
            <option key={key} value={key}>
              {
                [
                  w("全部", "全部", "All"),
                  w("标题", "標題", "Title"),
                  w("正文", "內文", "Body"),
                  w("标签", "標籤", "Tags"),
                ][i]
              }
            </option>
          ))}
        </select>
        <select
          aria-label={w("知识库", "知識庫", "Library")}
          value={filters.library}
          onChange={(e) => setFilters({ ...filters, library: e.target.value })}
        >
          <option value="">
            {w("全部知识库", "全部知識庫", "All libraries")}
          </option>
          {store.data.libraries.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <label>
          <input
            type="checkbox"
            checked={filters.starred}
            onChange={(e) =>
              setFilters({ ...filters, starred: e.target.checked })
            }
          />
          {w("仅收藏", "僅收藏", "Starred")}
        </label>
        <label>
          {w("更新起始", "更新起始", "Updated from")}
          <input
            type="date"
            value={filters.after}
            onChange={(e) => setFilters({ ...filters, after: e.target.value })}
          />
        </label>
        <label>
          {w("更新截止", "更新截止", "Updated until")}
          <input
            type="date"
            value={filters.before}
            onChange={(e) => setFilters({ ...filters, before: e.target.value })}
          />
        </label>
      </div>
      <p role="status" aria-live="polite">
        {hits.length} {w("篇笔记", "篇筆記", "notes")}
      </p>
      <div className="search-results">
        {hits.slice(0, limit).map((h) => (
          <button
            key={h.document.id}
            onClick={() => open(h.document.id, h.offset >= 0 ? query : "")}
          >
            <span>
              <b>{h.document.title}</b>
              <small>{h.snippet}</small>
            </span>
          </button>
        ))}
      </div>
      {hits.length > limit && (
        <Button variant="outline" onClick={() => setLimit((n) => n + 50)}>
          {w("显示更多", "顯示更多", "Show more")}
        </Button>
      )}
    </div>
  );
}
