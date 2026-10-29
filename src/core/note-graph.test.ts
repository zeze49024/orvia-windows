import { describe, expect, it } from "vitest";
import { buildNoteGraph, layoutNoteGraph } from "./note-graph";
import { emptyWorkspace, newDocument } from "./model";

describe("local note constellation", () => {
  it("resolves explicit Markdown/wiki references without code, images, deleted notes, self-links or external requests", () => {
    const w = emptyWorkspace(),
      lib = w.libraries[0];
    const a = newDocument(lib.id, "起点"),
      b = newDocument(lib.id, "目标"),
      c = newDocument(lib.id, "代码"),
      d = newDocument(lib.id, "已删除");
    d.deletedAt = new Date().toISOString();
    a.body = `[[目标]] [目标](%E7%9B%AE%E6%A0%87.md) [ID](orvia://note/${b.id})\n\n[ref][x]\n\n[x]: 目标.md\n\n![image](代码.md)\n\n\`[[代码]]\`\n\n\`\`\`\n[[代码]]\n\`\`\`\n\n[web](https://example.com/代码.md) [[已删除]] [[起点]]`;
    b.body = "[[起点]]";
    const g = buildNoteGraph([a, b, c, d], [lib]);
    expect(g.total).toBe(3);
    expect(g.nodes).toHaveLength(4);
    expect(g.edges.filter((e) => e.kind === "link")).toHaveLength(1);
    expect(g.edges.filter((e) => e.kind === "membership")).toHaveLength(3);
    expect(g.nodes.find((n) => n.id === a.id)?.degree).toBe(1);
  });
  it("avoids ambiguous aliases but accepts a library-qualified title", () => {
    const w = emptyWorkspace(),
      l = w.libraries[0],
      other = { ...l, id: crypto.randomUUID(), name: "工作" };
    const a = newDocument(l.id, "起点", "[[同名]] [[工作/同名]]"),
      b = newDocument(l.id, "同名"),
      c = newDocument(other.id, "同名");
    const links = buildNoteGraph([a, b, c], [l, other]).edges.filter(
      (e) => e.kind === "link",
    );
    expect(links).toEqual([{ source: a.id, target: c.id, kind: "link" }]);
  });
  it("classifies from real pinned state, diary metadata and unique note degree, without mutating documents", () => {
    const w = emptyWorkspace(),
      l = w.libraries[0],
      a = newDocument(l.id, "中心");
    const rest = Array.from({ length: 3 }, (_, i) =>
      newDocument(l.id, `来源${i}`, "[[中心]]"),
    );
    const diary = newDocument(l.id, "2026-10-29 日记"),
      pinned = newDocument(l.id, "置顶");
    pinned.pinned = true;
    const before = JSON.stringify([a, ...rest, diary, pinned]);
    const g = buildNoteGraph([a, ...rest, diary, pinned], [l]);
    expect(g.nodes.find((n) => n.id === a.id)?.kind).toBe("popular");
    expect(g.nodes.find((n) => n.id === diary.id)?.kind).toBe("diary");
    expect(g.nodes.find((n) => n.id === pinned.id)?.kind).toBe("pinned");
    expect(JSON.stringify([a, ...rest, diary, pinned])).toBe(before);
  });
  it("bounds visible notes with pinned priority and produces finite reproducible coordinates in all layouts", () => {
    const w = emptyWorkspace(),
      l = w.libraries[0],
      docs = Array.from({ length: 540 }, (_, i) =>
        newDocument(l.id, `笔记${i}`),
      );
    docs[539].pinned = true;
    const g = buildNoteGraph(docs, [l]);
    expect(g.total).toBe(540);
    expect(g.nodes).toHaveLength(501);
    expect(g.nodes.some((n) => n.id === docs[539].id)).toBe(true);
    for (const layout of ["force", "circle", "radial", "grid"] as const) {
      const points = layoutNoteGraph(g.nodes, g.edges, layout);
      expect(points.size).toBe(501);
      expect(
        [...points.values()].every(
          (p) => Number.isFinite(p.x) && Number.isFinite(p.y),
        ),
      ).toBe(true);
      expect(layoutNoteGraph(g.nodes, g.edges, layout)).toEqual(points);
    }
    expect(buildNoteGraph([], []).nodes).toEqual([]);
  });
});
