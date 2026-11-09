import {
  buildNoteGraph,
  graphLayouts,
  layoutNoteGraph,
  type GraphScope,
} from "./note-graph";
import type { Document, Library } from "./model";

// A bundled local worker keeps Markdown parsing off the writing/UI thread.
self.onmessage = (
  event: MessageEvent<{
    documents: Document[];
    libraries: Library[];
    scope: GraphScope;
  }>,
) => {
  try {
    const { documents, libraries, scope } = event.data;
    const graph = buildNoteGraph(documents, libraries, undefined, scope);
    for (const node of graph.nodes)
      if (node.doc)
        node.doc = { ...node.doc, body: node.doc.body.slice(0, 180) };
    const layouts = Object.fromEntries(
      graphLayouts.map((layout) => [
        layout,
        layoutNoteGraph(graph.nodes, graph.edges, layout),
      ]),
    );
    self.postMessage({ graph, layouts });
  } catch {
    self.postMessage({ error: true });
  }
};
