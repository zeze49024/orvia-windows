export function imageWidth(title: unknown): number {
  return Number(
    typeof title === "string"
      ? (/(?:^| )orvia-width:(25|50|75|100)%$/.exec(title)?.[1] ?? 100)
      : 100,
  );
}
export function imageTitle(title: string | null, width: number) {
  const original = (title ?? "").replace(
    /(?:^| )orvia-width:(25|50|75|100)%$/,
    "",
  );
  return width === 100
    ? original || null
    : `${original ? original + " " : ""}orvia-width:${width}%`;
}
export function markdownImage(src: string, alt: string, title: string | null) {
  const escape = (s: string) => s.replace(/\\/g, "\\\\").replace(/\n/g, " ");
  const label = escape(alt).replace(/\[/g, "\\[").replace(/\]/g, "\\]");
  return `![${label}](${src}${title ? ` "${escape(title).replace(/"/g, '\\"')}"` : ""})`;
}
