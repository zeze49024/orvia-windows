import { unified } from "unified";
import remarkParse from "remark-parse";
import type { Document, Library } from "./model";

export type GraphKind = "note" | "popular" | "diary" | "pinned" | "library";
export type GraphLayout = "force" | "circle" | "radial" | "grid";
export interface GraphNode {
  id: string;
  title: string;
  kind: GraphKind;
  libraryId: string;
  degree: number;
  doc?: Document;
}
export interface GraphEdge {
  source: string;
  target: string;
  kind: "link" | "membership";
}
export interface NoteGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  total: number;
}
export interface Point {
  x: number;
  y: number;
}
const parser = unified().use(remarkParse);
type Ast = {
  type: string;
  url?: string;
  value?: string;
  identifier?: string;
  children?: Ast[];
};
const normalized = (s: string) => s.normalize("NFC").trim().toLocaleLowerCase();

/** Resolve only explicit local references. Ambiguous titles and external URLs never form edges. */
export function buildNoteGraph(
  documents: Document[],
  libraries: Library[],
  limit = 500,
): NoteGraph {
  const alive = documents.filter((d) => !d.deletedAt);
  const byId = new Map(alive.map((d) => [d.id, d]));
  const aliases = new Map<string, Set<string>>();
  const libNames = new Map(libraries.map((l) => [l.id, l.name]));
  for (const d of alive) {
    for (const alias of [d.title, `${libNames.get(d.libraryId)}/${d.title}`]) {
      const key = normalized(alias);
      if (!key) continue;
      if (!aliases.has(key)) aliases.set(key, new Set());
      aliases.get(key)!.add(d.id);
    }
  }
  const picked = [...alive]
    .sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        b.updatedAt.localeCompare(a.updatedAt) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, Math.max(0, limit));
  const shown = new Set(picked.map((d) => d.id));
  const edges: GraphEdge[] = [],
    seen = new Set<string>(),
    degree = new Map<string, Set<string>>();
  const resolve = (raw: string): string | undefined => {
    let value: string;
    try {
      value = decodeURIComponent(raw.trim());
    } catch {
      return;
    }
    if (/^orvia:\/\/note\//i.test(value))
      value = value.replace(/^orvia:\/\/note\//i, "");
    else if (
      /^[a-z][a-z\d+.-]*:/i.test(value) ||
      value.startsWith("//") ||
      value.startsWith("#")
    )
      return;
    value = value.split(/[?#]/)[0].replace(/^\.\//, "").replace(/\.md$/i, "");
    if (byId.has(value)) return value;
    const ids = aliases.get(normalized(value));
    return ids?.size === 1 ? [...ids][0] : undefined;
  };
  for (const d of picked) {
    edges.push({
      source: `library:${d.libraryId}`,
      target: d.id,
      kind: "membership",
    });
    const targets = new Set<string>();
    // Bound work for multi-megabyte notes; parser never evaluates HTML or requests a URL.
    const tree = parser.parse(d.body.slice(0, 100_000)) as Ast;
    const definitions = new Map<string, string>();
    const walk = (node: Ast, visit: (n: Ast) => void) => {
      visit(node);
      node.children?.forEach((c) => walk(c, visit));
    };
    walk(tree, (n) => {
      if (n.type === "definition" && n.identifier && n.url)
        definitions.set(n.identifier.toLowerCase(), n.url);
    });
    walk(tree, (n) => {
      if (n.type === "link" && n.url) {
        const id = resolve(n.url);
        if (id) targets.add(id);
      }
      if (n.type === "linkReference" && n.identifier) {
        const id = resolve(definitions.get(n.identifier.toLowerCase()) ?? "");
        if (id) targets.add(id);
      }
      if (n.type === "text")
        for (const m of (n.value ?? "").matchAll(/\[\[([^\]\n]+)\]\]/g)) {
          const id = resolve(m[1].split("|")[0]);
          if (id) targets.add(id);
        }
    });
    for (const id of targets) {
      if (id === d.id || !shown.has(id)) continue;
      const key = [d.id, id].sort().join(":");
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ source: d.id, target: id, kind: "link" });
      for (const [a, b] of [
        [d.id, id],
        [id, d.id],
      ]) {
        if (!degree.has(a)) degree.set(a, new Set());
        degree.get(a)!.add(b);
      }
    }
  }
  const nodes: GraphNode[] = libraries.map((l) => ({
    id: `library:${l.id}`,
    title: l.name,
    kind: "library",
    libraryId: l.id,
    degree: 0,
  }));
  for (const d of picked) {
    const count = degree.get(d.id)?.size ?? 0;
    const diary =
      d.tags.some((t) => /^(日记|日記|diary|journal)$/i.test(t)) ||
      /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}(?:\b|\s|日)/.test(d.title);
    nodes.push({
      id: d.id,
      title: d.title,
      kind: d.pinned
        ? "pinned"
        : diary
          ? "diary"
          : count >= 3
            ? "popular"
            : "note",
      libraryId: d.libraryId,
      degree: count,
      doc: d,
    });
  }
  return { nodes, edges, total: alive.length };
}

/** Deterministic, bounded layouts; force uses a spatial grid rather than all-pairs repulsion. */
export function layoutNoteGraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
  layout: GraphLayout,
): Map<string, Point> {
  const points = new Map<string, Point>();
  const libs = nodes.filter((n) => n.kind === "library"),
    count = nodes.length;
  const radius = Math.max(240, Math.sqrt(count) * 38);
  nodes.forEach((n, i) => {
    const a = (i / Math.max(1, count)) * Math.PI * 2 - Math.PI / 2;
    points.set(n.id, { x: Math.cos(a) * radius, y: Math.sin(a) * radius });
  });
  if (layout === "grid") {
    const cols = Math.max(1, Math.ceil(Math.sqrt(count * 1.5)));
    nodes.forEach((n, i) =>
      points.set(n.id, {
        x: ((i % cols) - (cols - 1) / 2) * 170,
        y: (Math.floor(i / cols) - (Math.ceil(count / cols) - 1) / 2) * 110,
      }),
    );
  }
  if (layout === "radial" || layout === "force") {
    libs.forEach((l, i) => {
      const a = (i / Math.max(1, libs.length)) * Math.PI * 2;
      const center = {
        x: libs.length === 1 ? 0 : Math.cos(a) * radius,
        y: libs.length === 1 ? 0 : Math.sin(a) * radius,
      };
      points.set(l.id, center);
      const children = nodes.filter(
        (n) => n.kind !== "library" && n.libraryId === l.libraryId,
      );
      children.forEach((n, j) => {
        const angle = (j / Math.max(1, children.length)) * Math.PI * 2;
        const r = 110 + Math.floor(j / 12) * 65;
        points.set(n.id, {
          x: center.x + Math.cos(angle) * r,
          y: center.y + Math.sin(angle) * r,
        });
      });
    });
  }
  if (layout === "force") {
    for (let iteration = 0; iteration < 90; iteration++) {
      const cells = new Map<string, GraphNode[]>(),
        forces = new Map(nodes.map((n) => [n.id, { x: 0, y: 0 }]));
      for (const n of nodes) {
        const p = points.get(n.id)!;
        const key = `${Math.floor(p.x / 150)},${Math.floor(p.y / 150)}`;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key)!.push(n);
      }
      for (const n of nodes) {
        const p = points.get(n.id)!,
          f = forces.get(n.id)!;
        const cx = Math.floor(p.x / 150),
          cy = Math.floor(p.y / 150);
        for (let dx = -1; dx <= 1; dx++)
          for (let dy = -1; dy <= 1; dy++)
            for (const other of cells.get(`${cx + dx},${cy + dy}`) ?? []) {
              if (n.id === other.id) continue;
              const q = points.get(other.id)!;
              let x = p.x - q.x,
                y = p.y - q.y;
              if (x === 0 && y === 0) {
                x = 1;
                y = 0.5;
              }
              const sq = Math.max(64, x * x + y * y),
                force = 1800 / sq;
              f.x += x * force;
              f.y += y * force;
            }
        f.x -= p.x * 0.012;
        f.y -= p.y * 0.012;
      }
      for (const e of edges) {
        const p = points.get(e.source),
          q = points.get(e.target);
        if (!p || !q) continue;
        const x = q.x - p.x,
          y = q.y - p.y,
          d = Math.hypot(x, y) || 1;
        const k = (d - (e.kind === "membership" ? 145 : 120)) * 0.018;
        forces.get(e.source)!.x += (x / d) * k;
        forces.get(e.source)!.y += (y / d) * k;
        forces.get(e.target)!.x -= (x / d) * k;
        forces.get(e.target)!.y -= (y / d) * k;
      }
      const step = 1 - iteration / 110;
      for (const n of nodes) {
        const p = points.get(n.id)!,
          f = forces.get(n.id)!;
        p.x += Math.max(-10, Math.min(10, f.x)) * step;
        p.y += Math.max(-10, Math.min(10, f.y)) * step;
      }
    }
  }
  return points;
}
