import { native } from "./storage";
export type LocalFile = { name: string; bytes: Uint8Array };
export async function chooseFiles(
  extensions: string[],
  multiple = true,
): Promise<LocalFile[]> {
  if (native) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const { readFile, stat } = await import("@tauri-apps/plugin-fs");
    const selected = await open({
      multiple,
      filters: [{ name: "Orvia", extensions }],
    });
    if (!selected) return [];
    const paths = Array.isArray(selected) ? selected : [selected];
    const limit =
      extensions.includes("orvia") || extensions.includes("md")
        ? 128 * 1024 * 1024
        : 25 * 1024 * 1024;
    if (paths.length > 100) throw new Error("TOO_MANY_FILES");
    const sizes = await Promise.all(
      paths.map(async (path) => (await stat(path)).size),
    );
    if (
      sizes.some((size) => size > limit) ||
      sizes.reduce((sum, size) => sum + size, 0) > 128 * 1024 * 1024
    )
      throw new Error("FILE_TOO_LARGE");
    return Promise.all(
      paths.map(async (path) => ({
        name: path.split(/[\\/]/).pop()!,
        bytes: await readFile(path),
      })),
    );
  }
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = multiple;
    input.accept = extensions.map((e) => "." + e).join(",");
    input.style.display = "none";
    document.body.append(input);
    input.onchange = async () => {
      try {
        const files = Array.from(input.files ?? []);
        const limit =
          extensions.includes("orvia") || extensions.includes("md")
            ? 128 * 1024 * 1024
            : 25 * 1024 * 1024;
        if (
          files.length > 100 ||
          files.some((file) => file.size > limit) ||
          files.reduce((sum, file) => sum + file.size, 0) > 128 * 1024 * 1024
        )
          throw new Error("FILE_TOO_LARGE");
        resolve(
          await Promise.all(
            Array.from(input.files ?? [], async (f) => ({
              name: f.name,
              bytes: new Uint8Array(await f.arrayBuffer()),
            })),
          ),
        );
      } catch (error) {
        reject(error);
      } finally {
        input.remove();
      }
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
}
export async function saveFile(
  name: string,
  bytes: Uint8Array,
  extensions: string[],
): Promise<boolean> {
  if (native) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeFile } = await import("@tauri-apps/plugin-fs");
    const path = await save({
      defaultPath: name,
      filters: [{ name: "Orvia", extensions }],
    });
    if (!path) return false;
    await writeFile(path, bytes);
    return true;
  }
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer]));
  const a = document.createElement("a");
  a.download = name;
  a.href = url;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
