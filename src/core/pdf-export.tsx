import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { invoke } from "@tauri-apps/api/core";
import { native, getAsset } from "./storage";
import { safeFilename, type Workspace } from "./model";
import { imageWidth } from "./image-options";
export async function preparePdf(data: Workspace, id: string) {
  const doc = data.documents.find((d) => d.id === id && !d.deletedAt);
  if (!doc) throw new Error("DOCUMENT_NOT_FOUND");
  const urls = new Map<string, string>();
  let host: HTMLDivElement | undefined;
  let root: ReturnType<typeof createRoot> | undefined;
  const cleanup = () => {
    root?.unmount();
    host?.remove();
    urls.forEach((url) => URL.revokeObjectURL(url));
  };
  try {
    const needed = data.assets.filter((a) =>
      doc.body.includes("asset:" + a.id),
    );
    if (needed.reduce((sum, a) => sum + a.size, 0) > 128 * 1024 * 1024)
      throw new Error("EXPORT_TOO_LARGE");
    for (const asset of needed) {
      const bytes = await getAsset(asset);
      urls.set(
        "asset:" + asset.id,
        URL.createObjectURL(
          new Blob([new Uint8Array(bytes).buffer], { type: asset.mime }),
        ),
      );
    }
    host = document.createElement("div");
    host.className = "pdf-export-root";
    document.body.append(host);
    root = createRoot(host);
    flushSync(() =>
      root!.render(
        <article className="pdf-document">
          <h1 className="pdf-title">{doc.title}</h1>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            urlTransform={(url) =>
              url.startsWith("asset:") || /^https?:\/\//i.test(url) ? url : ""
            }
            components={{
              img: ({ src, alt, title }) =>
                urls.has(src ?? "") ? (
                  <img
                    src={urls.get(src!)}
                    alt={alt ?? ""}
                    style={{ width: `${imageWidth(title)}%` }}
                  />
                ) : (
                  <span className="pdf-missing-image">[{alt || "Image"}]</span>
                ),
            }}
          >
            {doc.body}
          </ReactMarkdown>
        </article>,
      ),
    );
    await document.fonts.ready;
    await Promise.all(
      Array.from(host.querySelectorAll("img"), (image) => image.decode()),
    );
    return { host, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}
export async function exportPdf(data: Workspace, id: string) {
  const doc = data.documents.find((d) => d.id === id && !d.deletedAt);
  if (!doc) throw new Error("DOCUMENT_NOT_FOUND");
  let token: string | null = null;
  if (native) {
    token = await invoke<string | null>("pick_pdf_target", {
      name: safeFilename(doc.title) + ".pdf",
    });
    if (!token) return false;
  }
  let printed: Awaited<ReturnType<typeof preparePdf>> | undefined;
  try {
    printed = await preparePdf(data, id);
    if (native) await invoke("export_pdf", { token });
    else
      await new Promise<void>((resolve, reject) => {
        const done = () => {
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(() => {
          window.removeEventListener("afterprint", done);
          reject(new Error("PDF_PRINT_TIMEOUT"));
        }, 120000);
        window.addEventListener("afterprint", done, { once: true });
        try {
          window.print();
        } catch (e) {
          clearTimeout(timer);
          window.removeEventListener("afterprint", done);
          reject(e);
        }
      });
    return true;
  } finally {
    printed?.cleanup();
    if (token) await invoke("revoke_pdf_target", { token }).catch(() => {});
  }
}
