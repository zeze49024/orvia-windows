import { zipSync } from "fflate";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { exportMarkdownDocument } from "./markdown-export";
import type { Document, Workspace } from "./model";
import { safeFilename } from "./model";

export function updateDocuments(
  data: Workspace,
  ids: string[],
  patch: Partial<Pick<Document, "libraryId" | "pinned" | "deletedAt">>,
): Workspace {
  if (patch.libraryId && !data.libraries.some((l) => l.id === patch.libraryId))
    throw new Error("UNKNOWN_LIBRARY");
  const targets = new Set(ids),
    now = new Date().toISOString();
  return {
    ...data,
    documents: data.documents.map((d) =>
      targets.has(d.id) && !d.deletedAt
        ? { ...d, ...patch, updatedAt: now }
        : d,
    ),
  };
}

export function uniqueFilename(name: string, used: Set<string>) {
  const dot = name.lastIndexOf("."),
    stem = dot > 0 ? name.slice(0, dot) : name,
    ext = dot > 0 ? name.slice(dot) : "";
  let result = name,
    n = 2;
  while (used.has(result.toLocaleLowerCase("en-US")))
    result = `${stem} (${n++})${ext}`;
  used.add(result.toLocaleLowerCase("en-US"));
  return result;
}

export async function exportDocuments(data: Workspace, ids: string[]) {
  const used = new Set<string>(),
    files: { name: string; bytes: Uint8Array }[] = [];
  let size = 0;
  for (const id of new Set(ids)) {
    const file = await exportMarkdownDocument(data, id);
    size += file.bytes.length;
    if (size > 128 * 1024 * 1024) throw new Error("EXPORT_TOO_LARGE");
    files.push({ ...file, name: uniqueFilename(file.name, used) });
  }
  if (!files.length) throw new Error("DOCUMENT_NOT_FOUND");
  return files;
}
export function zipDocuments(files: { name: string; bytes: Uint8Array }[]) {
  return zipSync(Object.fromEntries(files.map((f) => [f.name, f.bytes])));
}

// No raw HTML, scripts, remote images or network connections in a shared file.
export async function shareDocuments(data: Workspace, ids: string[]) {
  const files = await exportDocuments(data, ids);
  const docs = [...new Set(ids)].map((id) =>
    data.documents.find((d) => d.id === id)!,
  );
  const html = renderToStaticMarkup(
    <html lang={data.settings.locale}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <meta
          httpEquiv="Content-Security-Policy"
          content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"
        />
        <meta name="referrer" content="no-referrer" />
        <title>{docs.length === 1 ? docs[0].title : "Orvia"}</title>
        <style>{`body{font:17px/1.75 system-ui,sans-serif;color:#222;background:#fff;margin:0 auto;padding:40px 24px;max-width:850px}article{padding-bottom:48px;border-bottom:1px solid #ddd;margin-bottom:48px}h1,h2,h3{line-height:1.3}img{max-width:100%;height:auto}pre{overflow:auto;background:#f4f4f4;padding:16px;border-radius:8px}code{overflow-wrap:anywhere}blockquote{border-left:3px solid #bbb;padding-left:16px;color:#555}table{border-collapse:collapse;display:block;overflow:auto}td,th{border:1px solid #ddd;padding:8px}a{color:#245bc2}h1{overflow-wrap:anywhere}`}</style>
      </head>
      <body>
        {files.map((f, i) => (
          <article key={docs[i].id}>
            <header>
              <h1>{docs[i].title}</h1>
            </header>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              skipHtml
              urlTransform={(url, key) =>
                key === "src"
                  ? /^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i.test(
                      url,
                    )
                    ? url
                    : ""
                  : /^https?:\/\//i.test(url) || url.startsWith("#")
                    ? url
                    : ""
              }
              components={{
                img: ({ src, alt }) =>
                  src ? <img src={src} alt={alt} /> : <span>{alt}</span>,
                a: ({ href, children }) => (
                  <a href={href} rel="noreferrer noopener">
                    {children}
                  </a>
                ),
              }}
            >
              {new TextDecoder().decode(f.bytes)}
            </ReactMarkdown>
          </article>
        ))}
      </body>
    </html>,
  );
  const bytes = new TextEncoder().encode("<!doctype html>" + html);
  if (bytes.length > 128 * 1024 * 1024) throw new Error("EXPORT_TOO_LARGE");
  return {
    name: safeFilename(docs.length === 1 ? docs[0].title : "Orvia") + ".html",
    bytes,
  };
}
