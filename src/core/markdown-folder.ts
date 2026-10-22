import { native } from "./storage";
import type { LocalFile } from "./files";

type Entry = { path: string; size: number; read: () => Promise<Uint8Array> };

export function relativeImagePath(documentPath: string, url: string) {
  const decoded = decodeURIComponent(url.split(/[?#]/)[0]);
  if (/^(?:[a-z][a-z0-9+.-]*:|[\\/])/i.test(decoded) || decoded.includes("\0"))
    throw new Error("IMAGE_OUTSIDE_FOLDER");
  const parts = documentPath.split("/").slice(0, -1);
  for (const part of decoded.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) throw new Error("IMAGE_OUTSIDE_FOLDER");
      parts.pop();
    } else parts.push(part);
  }
  return parts.join("/");
}

export async function markdownFolderFiles(
  entries: Entry[],
): Promise<LocalFile[]> {
  if (entries.length > 5000) throw new Error("TOO_MANY_FILES");
  const documents = entries.filter((entry) =>
    /\.(?:md|markdown)$/i.test(entry.path),
  );
  if (!documents.length) throw new Error("NO_MARKDOWN_FILES");
  if (documents.length > 100) throw new Error("TOO_MANY_FILES");
  const paths = new Map(entries.map((entry) => [entry.path, entry]));
  if (paths.size !== entries.length) throw new Error("DUPLICATE_FILE_PATH");
  let total = 0;
  const cache = new Map<string, Promise<Uint8Array>>();
  const read = (entry: Entry, limit: number) => {
    if (entry.size > limit) throw new Error("FILE_TOO_LARGE");
    if (!cache.has(entry.path)) {
      total += entry.size;
      if (total > 128 * 1024 * 1024) throw new Error("FILE_TOO_LARGE");
      cache.set(
        entry.path,
        entry.read().then((bytes) => {
          if (bytes.length !== entry.size)
            throw new Error("FILE_CHANGED_DURING_IMPORT");
          return bytes;
        }),
      );
    }
    return cache.get(entry.path)!;
  };
  return Promise.all(
    documents.map(async (entry) => ({
      name: entry.path.split("/").pop()!,
      bytes: await read(entry, 128 * 1024 * 1024),
      resolveImage: async (url: string) => {
        const path = relativeImagePath(entry.path, url);
        const image = paths.get(path);
        if (!image || !/\.(?:png|jpe?g|gif|webp)$/i.test(path))
          throw new Error("RELATIVE_IMAGE_NOT_FOUND");
        return read(image, 20 * 1024 * 1024);
      },
    })),
  );
}

/** Explicit folder selection grants access only to the selected tree. No remote fetching. */
export async function chooseMarkdownFolder(): Promise<LocalFile[]> {
  if (native) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const { readDir, readFile, stat } = await import("@tauri-apps/plugin-fs");
    const root = await open({
      directory: true,
      recursive: true,
      multiple: false,
    });
    if (!root) return [];
    const entries: Entry[] = [];
    let count = 0;
    const walk = async (path: string, prefix = "", depth = 0) => {
      if (depth > 16) throw new Error("FOLDER_TOO_DEEP");
      for (const item of await readDir(path)) {
        if (++count > 5000) throw new Error("TOO_MANY_FILES");
        if (item.isSymlink || item.name.startsWith(".")) continue;
        const absolute = path + "/" + item.name,
          relative = prefix + item.name;
        if (item.isDirectory) await walk(absolute, relative + "/", depth + 1);
        else if (
          item.isFile &&
          /\.(?:md|markdown|png|jpe?g|gif|webp)$/i.test(item.name)
        ) {
          const info = await stat(absolute);
          entries.push({
            path: relative,
            size: info.size,
            read: () => readFile(absolute),
          });
        }
      }
    };
    await walk(root);
    return markdownFolderFiles(entries);
  }
  const files = await new Promise<File[]>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.webkitdirectory = true;
    input.style.display = "none";
    document.body.append(input);
    input.onchange = () => {
      const files = [...(input.files ?? [])];
      input.remove();
      resolve(files);
    };
    input.addEventListener(
      "cancel",
      () => {
        input.remove();
        resolve([]);
      },
      { once: true },
    );
    input.click();
  });
  if (!files.length) return [];
  return markdownFolderFiles(
    files.map((file) => ({
      path: file.webkitRelativePath.split("/").slice(1).join("/"),
      size: file.size,
      read: async () => new Uint8Array(await file.arrayBuffer()),
    })),
  );
}
