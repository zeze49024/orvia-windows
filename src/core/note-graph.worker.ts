import { buildNoteGraph } from "./note-graph";
import type { Document, Library } from "./model";

// A bundled local worker keeps Markdown parsing off the writing/UI thread.
self.onmessage = (
  event: MessageEvent<{ documents: Document[]; libraries: Library[] }>,
) => {
  try {
    const graph = buildNoteGraph(event.data.documents, event.data.libraries);
    for (const node of graph.nodes)
      if (node.doc)
        node.doc = { ...node.doc, body: node.doc.body.slice(0, 180) };
    self.postMessage({ graph });
  } catch {
    self.postMessage({ error: true });
  }
};
