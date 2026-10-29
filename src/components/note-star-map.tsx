import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowUpRight,
  Circle,
  CircleHelp,
  Focus,
  Folder,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Network,
  Orbit,
  RotateCcw,
  Search,
  Sparkles,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  layoutNoteGraph,
  type NoteGraph,
  type GraphKind,
  type GraphLayout,
  type Point,
} from "@/core/note-graph";
import type { Locale, Workspace } from "@/core/model";
import { translator } from "@/i18n";

const kinds: GraphKind[] = ["note", "popular", "diary", "pinned", "library"];
const layouts: GraphLayout[] = ["force", "circle", "radial", "grid"];
export function NoteStarMap({
  data,
  locale,
  onOpen,
  onLibrary,
}: {
  data: Workspace;
  locale: Locale;
  onOpen: (id: string) => void;
  onLibrary: (id: string) => void;
}) {
  const t = translator(locale),
    id = useId().replace(/:/g, "");
  const [query, setQuery] = useState(""),
    [library, setLibrary] = useState("all"),
    [layout, setLayout] = useState<GraphLayout>("force"),
    [hidden, setHidden] = useState<GraphKind[]>([]),
    [selectedId, setSelectedId] = useState(""),
    [hover, setHover] = useState(""),
    [expanded, setExpanded] = useState(false),
    [help, setHelp] = useState(false);
  const [size, setSize] = useState({ width: 1000, height: 620 }),
    [camera, setCamera] = useState({ x: 0, y: 0, k: 1 }),
    [moved, setMoved] = useState<Map<string, Point>>(new Map());
  const stage = useRef<HTMLDivElement>(null),
    svg = useRef<SVGSVGElement>(null),
    drag = useRef<{
      id: string;
      x: number;
      y: number;
      point: Point;
      moved: boolean;
    } | null>(null),
    dragged = useRef(false);
  const [graph, setGraph] = useState<NoteGraph>({
      nodes: [],
      edges: [],
      total: 0,
    }),
    [loading, setLoading] = useState(true),
    [failed, setFailed] = useState(false),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    setLoading(true);
    setGraph({ nodes: [], edges: [], total: 0 });
    setFailed(false);
    setSelectedId("");
    const worker = new Worker(
      new URL("../core/note-graph.worker.ts", import.meta.url),
      { type: "module" },
    );
    const documents = data.documents.filter(
      (d) => !d.deletedAt && (library === "all" || d.libraryId === library),
    );
    const picked = new Set(
      [...documents]
        .sort(
          (a, b) =>
            Number(b.pinned) - Number(a.pinned) ||
            b.updatedAt.localeCompare(a.updatedAt) ||
            a.id.localeCompare(b.id),
        )
        .slice(0, 500)
        .map((d) => d.id),
    );
    worker.onmessage = (
      event: MessageEvent<{ graph?: NoteGraph; error?: boolean }>,
    ) => {
      if (event.data.graph) setGraph(event.data.graph);
      setFailed(!!event.data.error);
      setLoading(false);
    };
    worker.onerror = () => {
      setFailed(true);
      setLoading(false);
    };
    worker.postMessage({
      documents: documents.map((d) => ({
        ...d,
        body: picked.has(d.id) ? d.body.slice(0, 100_000) : "",
      })),
      libraries: data.libraries.filter(
        (l) => library === "all" || l.id === library,
      ),
    });
    return () => worker.terminate();
  }, [data.documents, data.libraries, library, retry]);
  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    const matches = graph.nodes.filter(
      (n) =>
        !hidden.includes(n.kind) &&
        (!q ||
          (n.title + " " + (n.doc?.tags.join(" ") ?? ""))
            .toLocaleLowerCase()
            .includes(q)),
    );
    const parents = new Set(
      matches
        .filter((n) => n.kind !== "library")
        .map((n) => `library:${n.libraryId}`),
    );
    const nodes = graph.nodes.filter(
      (n) =>
        matches.includes(n) ||
        (n.kind === "library" &&
          !hidden.includes("library") &&
          parents.has(n.id)),
    );
    const ids = new Set(nodes.map((n) => n.id));
    return {
      nodes,
      edges: graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target)),
    };
  }, [graph, hidden, query]);
  const points = useMemo(
    () => layoutNoteGraph(filtered.nodes, filtered.edges, layout),
    [filtered, layout],
  );
  const position = (nodeId: string) => moved.get(nodeId) ?? points.get(nodeId)!;
  const selected = filtered.nodes.find((n) => n.id === selectedId),
    focused =
      (filtered.nodes.some((n) => n.id === hover) ? hover : "") || selected?.id;
  const connected = new Set([
    focused,
    ...filtered.edges
      .filter((e) => e.source === focused || e.target === focused)
      .flatMap((e) => [e.source, e.target]),
  ]);
  const fit = useCallback(() => {
    const p = [...points.values()];
    if (!p.length) {
      setCamera({ x: 0, y: 0, k: 1 });
      return;
    }
    const minX = Math.min(...p.map((v) => v.x)) - 95,
      maxX = Math.max(...p.map((v) => v.x)) + 95,
      minY = Math.min(...p.map((v) => v.y)) - 65,
      maxY = Math.max(...p.map((v) => v.y)) + 65;
    const k = Math.min(
      1.5,
      Math.max(
        0.12,
        Math.min(
          (size.width - 70) / (maxX - minX),
          (size.height - 120) / (maxY - minY),
        ),
      ),
    );
    setCamera({ x: (-(minX + maxX) / 2) * k, y: (-(minY + maxY) / 2) * k, k });
    setMoved(new Map());
  }, [points, size]);
  useEffect(() => {
    fit();
  }, [fit]);
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width && entry.contentRect.height)
        setSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const zoom = useCallback(
    (factor: number, px = 0, py = 0) =>
      setCamera((c) => {
        const k = Math.max(0.12, Math.min(3, c.k * factor)),
          r = k / c.k;
        return { x: px - (px - c.x) * r, y: py - (py - c.y) * r, k };
      }),
    [],
  );
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const box = element.getBoundingClientRect();
      zoom(
        Math.exp(-event.deltaY * 0.0015),
        event.clientX - box.left - box.width / 2,
        event.clientY - box.top - box.height / 2,
      );
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [zoom]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setExpanded(false);
        setHelp(false);
        setSelectedId("");
      }
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, []);
  const start = (event: React.PointerEvent<SVGElement>, nodeId = "") => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragged.current = false;
    drag.current = {
      id: nodeId,
      x: event.clientX,
      y: event.clientY,
      point: nodeId ? { ...position(nodeId) } : { x: camera.x, y: camera.y },
      moved: false,
    };
  };
  const move = (event: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = event.clientX - d.x,
      dy = event.clientY - d.y;
    if (Math.hypot(dx, dy) > 4) d.moved = true;
    if (!d.moved) return;
    dragged.current = true;
    if (d.id)
      setMoved((old) =>
        new Map(old).set(d.id, {
          x: d.point.x + dx / camera.k,
          y: d.point.y + dy / camera.k,
        }),
      );
    else setCamera((c) => ({ ...c, x: d.point.x + dx, y: d.point.y + dy }));
  };
  const stop = () => {
    drag.current = null;
  };
  const open = (nodeId: string) => {
    const node = filtered.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    if (node.kind === "library") onLibrary(node.libraryId);
    else onOpen(node.id);
  };
  const notes = filtered.nodes.filter((n) => n.kind !== "library").length,
    links = filtered.edges.filter((e) => e.kind === "link").length;
  return (
    <section
      className={`star-map ${expanded ? "star-map-expanded" : ""}`}
      aria-label={t("noteStarMap")}
    >
      <header className="star-map-heading">
        <div className="star-map-title">
          <span className="star-map-mark">
            <Orbit size={25} />
          </span>
          <div>
            <div className="star-map-eyebrow">ORVIA / {t("graphExplore")}</div>
            <h1>{t("noteStarMap")}</h1>
            <p>{t("graphSubtitle")}</p>
          </div>
        </div>
        <div className="star-map-metrics">
          <span>
            <b>{notes}</b>
            {t("graphNotes")}
          </span>
          <span>
            <b>{links}</b>
            {t("graphLinks")}
          </span>
          <span>
            <b>{filtered.nodes.length - notes}</b>
            {t("libraries")}
          </span>
        </div>
      </header>
      <div className="star-map-controls">
        <label className="star-map-search">
          <Search size={16} />
          <Input
            aria-label={t("graphSearch")}
            placeholder={t("graphSearch")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button
              aria-label={t("graphClearSearch")}
              onClick={() => setQuery("")}
            >
              <X size={14} />
            </button>
          )}
        </label>
        <select
          aria-label={t("graphLibraryFilter")}
          value={library}
          onChange={(e) => {
            setLibrary(e.target.value);
            setSelectedId("");
          }}
        >
          <option value="all">{t("graphAllLibraries")}</option>
          {data.libraries.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <div
          className="star-map-layout"
          role="group"
          aria-label={t("graphLayout")}
        >
          {layouts.map((value) => (
            <button
              key={value}
              aria-pressed={layout === value}
              onClick={() => setLayout(value)}
            >
              {t(`graphLayout_${value}`)}
            </button>
          ))}
        </div>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={t("graphHelp")}
          aria-expanded={help}
          onClick={() => setHelp(!help)}
        >
          <CircleHelp size={18} />
        </Button>
      </div>
      {help && (
        <div className="star-map-help">
          <b>{t("graphHelp")}</b>
          <p>{t("graphInstructions")}</p>
          <p>{t("graphRelationHelp")}</p>
          <p>{t("graphClassification")}</p>
          <p>{t("graphLimitHelp")}</p>
        </div>
      )}
      <div className="star-map-legend" aria-label={t("graphLegend")}>
        {kinds.map((kind) => (
          <button
            key={kind}
            aria-pressed={!hidden.includes(kind)}
            onClick={() =>
              setHidden((old) =>
                old.includes(kind)
                  ? old.filter((k) => k !== kind)
                  : [...old, kind],
              )
            }
          >
            <i className={`star-map-dot graph-${kind}`} />
            {t(`graphKind_${kind}`)}
          </button>
        ))}
        <span className="star-map-relation">
          <i />
          {t("graphMembership")}
          <i className="solid" />
          {t("graphReference")}
        </span>
      </div>
      <div className="star-map-stage" ref={stage} aria-busy={loading}>
        <svg
          ref={svg}
          className="star-map-canvas"
          width="100%"
          height="100%"
          aria-label={t("graphCanvas")}
          onPointerDown={(e) => start(e)}
          onPointerMove={move}
          onPointerUp={stop}
          onPointerCancel={stop}
          onLostPointerCapture={stop}
          onClick={() => {
            if (!dragged.current) setSelectedId("");
          }}
        >
          <defs>
            <pattern
              id={`dots-${id}`}
              width="24"
              height="24"
              patternUnits="userSpaceOnUse"
            >
              <circle cx="1" cy="1" r=".8" fill="var(--line)" />
            </pattern>
            <filter
              id={`shadow-${id}`}
              x="-100%"
              y="-100%"
              width="300%"
              height="300%"
            >
              <feDropShadow dx="0" dy="3" stdDeviation="4" floodOpacity=".09" />
            </filter>
          </defs>
          <rect width="100%" height="100%" fill={`url(#dots-${id})`} />
          <g
            visibility={
              loading || failed || graph.total === 0 ? "hidden" : "visible"
            }
            transform={`translate(${size.width / 2 + camera.x},${size.height / 2 + camera.y}) scale(${camera.k})`}
          >
            {filtered.edges.map((e) => {
              const a = position(e.source),
                b = position(e.target);
              return (
                <line
                  key={`${e.source}-${e.target}-${e.kind}`}
                  className={`star-map-edge ${e.kind} ${focused ? (connected.has(e.source) && connected.has(e.target) ? "is-connected" : "is-dimmed") : ""}`}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                />
              );
            })}
            {filtered.nodes.map((n) => {
              const p = position(n.id),
                r = n.kind === "library" ? 19 : n.kind === "popular" ? 14 : 11;
              return (
                <g
                  key={n.id}
                  transform={`translate(${p.x},${p.y}) scale(${1 / camera.k})`}
                  className={`star-map-node graph-${n.kind} ${n.id === selected?.id ? "is-selected" : ""} ${focused && !connected.has(n.id) ? "is-dimmed" : ""}`}
                  role="button"
                  tabIndex={0}
                  aria-label={`${n.title || t("untitled")} · ${t(`graphKind_${n.kind}`)}`}
                  aria-pressed={selected?.id === n.id}
                  onPointerDown={(e) => start(e, n.id)}
                  onPointerEnter={() => {
                    if (!drag.current) setHover(n.id);
                  }}
                  onPointerLeave={() => setHover("")}
                  onFocus={() => setHover(n.id)}
                  onBlur={() => setHover("")}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!dragged.current) setSelectedId(n.id);
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    if (!dragged.current) open(n.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      open(n.id);
                    }
                    if (e.key === " ") {
                      e.preventDefault();
                      setSelectedId(n.id);
                    }
                  }}
                >
                  <title>{n.title || t("untitled")}</title>
                  <circle className="node-halo" r={r + 8} />
                  {n.kind === "library" ? (
                    <>
                      <rect
                        className="node-shape"
                        x="-19"
                        y="-19"
                        width="38"
                        height="38"
                        rx="12"
                        filter={`url(#shadow-${id})`}
                      />
                      <Folder size={17} x={-8.5} y={-8.5} />
                    </>
                  ) : (
                    <>
                      <circle
                        className="node-shape"
                        r={r}
                        filter={`url(#shadow-${id})`}
                      />
                      <circle className="node-core" r={3.5} />
                    </>
                  )}
                  {n.doc?.starred && (
                    <circle
                      className="node-favorite"
                      cx={r - 1}
                      cy={-r + 1}
                      r="4"
                    />
                  )}
                  <text y={r + 22} textAnchor="middle">
                    {n.title.length > 17
                      ? n.title.slice(0, 16) + "…"
                      : n.title || t("untitled")}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
        {(loading || failed || !filtered.nodes.length || graph.total === 0) && (
          <div className="star-map-empty" role="status">
            {loading ? (
              <LoaderCircle size={28} className="star-map-loading" />
            ) : (
              <Sparkles size={32} />
            )}
            <h2>
              {t(
                loading
                  ? "graphLoading"
                  : failed
                    ? "graphFailed"
                    : graph.total
                      ? "graphNoMatches"
                      : "graphEmpty",
              )}
            </h2>
            {!loading && (
              <p>
                {t(
                  failed
                    ? "graphRetryHint"
                    : graph.total
                      ? "graphTryFilters"
                      : "graphEmptyHint",
                )}
              </p>
            )}
            {failed ? (
              <Button variant="outline" onClick={() => setRetry((n) => n + 1)}>
                {t("retry")}
              </Button>
            ) : (
              !loading &&
              graph.total > 0 && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setQuery("");
                    setHidden([]);
                    setLibrary("all");
                  }}
                >
                  {t("graphResetFilters")}
                </Button>
              )
            )}
          </div>
        )}
        {selected && (
          <aside
            className={`star-map-detail ${position(selected.id).x * camera.k + camera.x > 0 ? "is-left" : ""}`}
          >
            <div className="star-map-detail-label">
              <span className={`star-map-dot graph-${selected.kind}`} />
              {t(`graphKind_${selected.kind}`)}
              <button aria-label={t("close")} onClick={() => setSelectedId("")}>
                <X size={15} />
              </button>
            </div>
            <h2>{selected.title || t("untitled")}</h2>
            <p>
              {selected.kind === "library"
                ? t("graphLibraryHint")
                : selected.doc?.body.replace(/[#*>`\[\]]/g, "").slice(0, 120) ||
                  t("graphBlankNote")}
            </p>
            <div className="star-map-detail-footer">
              <span>
                {selected.degree} {t("graphLinks")}
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => open(selected.id)}
              >
                {t(
                  selected.kind === "library"
                    ? "graphOpenLibrary"
                    : "graphOpenNote",
                )}
                <ArrowUpRight size={14} />
              </Button>
            </div>
          </aside>
        )}
        <div
          className="star-map-zoom"
          role="group"
          aria-label={t("graphViewport")}
        >
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t("graphZoomOut")}
            onClick={() => zoom(1 / 1.25)}
          >
            <ZoomOut size={17} />
          </Button>
          <span>{Math.round(camera.k * 100)}%</span>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t("graphZoomIn")}
            onClick={() => zoom(1.25)}
          >
            <ZoomIn size={17} />
          </Button>
          <i />
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t("graphFit")}
            onClick={fit}
          >
            <Focus size={17} />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t("graphReset")}
            onClick={() => {
              setLayout("force");
              setQuery("");
              setLibrary("all");
              setHidden([]);
              setSelectedId("");
              fit();
            }}
          >
            <RotateCcw size={16} />
          </Button>
          <i />
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t(expanded ? "graphCollapse" : "graphExpand")}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </Button>
        </div>
        <div className="star-map-corner">
          <Network size={14} />
          {t("graphLocal")}
        </div>
      </div>
      <footer className="star-map-footer">
        <span>
          <Circle size={8} fill="currentColor" />
          {t("graphHint")}
        </span>
        <span>
          {graph.total > 500
            ? `${t("graphLimited")} · ${graph.total}`
            : t("graphFooter")}
        </span>
      </footer>
    </section>
  );
}
