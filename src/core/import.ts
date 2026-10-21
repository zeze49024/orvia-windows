import { strFromU8 } from "fflate";
import Turndown from "turndown";
import { putAsset } from "./storage";
import { safeUnzip } from "./backup";
import type { Asset } from "./model";
import type { LocalFile } from "./files";
export function imageMime(bytes: Uint8Array): Asset["mime"] {
  if (bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71)
    return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return "image/jpeg";
  if (strFromU8(bytes.slice(0, 6)).startsWith("GIF8")) return "image/gif";
  if (
    strFromU8(bytes.slice(0, 4)) === "RIFF" &&
    strFromU8(bytes.slice(8, 12)) === "WEBP"
  )
    return "image/webp";
  throw new Error("UNSUPPORTED_IMAGE");
}
export async function convertFile(
  file: LocalFile,
  signal: AbortSignal,
): Promise<{ title: string; body: string; assets: Asset[] }> {
  if (file.bytes.length > 25 * 1024 * 1024) throw new Error("FILE_TOO_LARGE");
  signal.throwIfAborted();
  const ext = file.name.split(".").pop()?.toLowerCase();
  const title = file.name.replace(/\.[^.]+$/, "");
  let body = "";
  const assets: Asset[] = [];
  if (ext === "md" || ext === "markdown" || ext === "txt")
    body = strFromU8(file.bytes).replace(/^\uFEFF/, "");
  else if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext ?? "")) {
    const a = await putAsset(file.bytes, imageMime(file.bytes));
    assets.push(a);
    body = `![${title.replace(/[\[\]]/g, "")}](asset:${a.id})`;
  } else if (ext === "docx") {
    safeUnzip(file.bytes, 128 * 1024 * 1024);
    const mammoth = await import("mammoth/mammoth.browser");
    const result = await mammoth.convertToHtml(
      { arrayBuffer: new Uint8Array(file.bytes).buffer },
      {
        convertImage: mammoth.images.imgElement(
          async (image: {
            read: (encoding: string) => Promise<string>;
            contentType: string;
          }) => {
            signal.throwIfAborted();
            const encoded = await image.read("base64");
            const bytes = Uint8Array.from(atob(encoded), (c) =>
              c.charCodeAt(0),
            );
            const a = await putAsset(bytes, imageMime(bytes));
            assets.push(a);
            return { src: "asset:" + a.id };
          },
        ),
      },
    );
    signal.throwIfAborted();
    body = new Turndown({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
    }).turndown(result.value);
  } else if (ext === "pdf") {
    const pdf = await import("pdfjs-dist");
    const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
    pdf.GlobalWorkerOptions.workerSrc = worker.default;
    const task = pdf.getDocument({
      data: new Uint8Array(file.bytes),
      useSystemFonts: true,
      cMapUrl: "/pdf/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "/pdf/standard_fonts/",
      wasmUrl: "/pdf/wasm/",
    });
    const cancel = () => {
      void task.destroy();
    };
    signal.addEventListener("abort", cancel, { once: true });
    try {
      const document = await task.promise;
      if (document.numPages > 200) throw new Error("PDF_PAGE_LIMIT");
      let textFound = false;
      for (let i = 1; i <= document.numPages; i++) {
        signal.throwIfAborted();
        const page = await document.getPage(i);
        const content = await page.getTextContent();
        const lines = content.items
          .map((item) =>
            "str" in item
              ? item.str + ("hasEOL" in item && item.hasEOL ? "\n" : " ")
              : "",
          )
          .join("");
        if (lines.trim()) textFound = true;
        body += (i > 1 ? "\n\n---\n\n" : "") + lines.trim();
        page.cleanup();
      }
      if (!textFound) throw new Error("PDF_OCR_UNSUPPORTED");
    } finally {
      signal.removeEventListener("abort", cancel);
      await task.destroy();
    }
  } else throw new Error("UNSUPPORTED_FORMAT");
  signal.throwIfAborted();
  if (body.length > 5_000_000) throw new Error("FILE_TOO_LARGE");
  return { title, body, assets };
}
