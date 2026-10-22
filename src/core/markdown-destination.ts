/** Replace the destination token only, preserving alt text, titles and delimiters.
 * The caller supplies an image/definition span already validated by remark. */
export function replaceDestination(source: string, url: string) {
  const first = source.search(/\S/);
  let index = first + (source[first] === "!" ? 2 : 1);
  let brackets = 1;
  for (; index < source.length && brackets; index++) {
    if (source[index] === "\\") index++;
    else if (source[index] === "[") brackets++;
    else if (source[index] === "]") brackets--;
  }
  if (brackets || !["(", ":"].includes(source[index]))
    throw new Error("MARKDOWN_DESTINATION");
  index++;
  while (/\s/.test(source[index] ?? "") && index < source.length) index++;
  const angled = source[index] === "<";
  if (angled) index++;
  const start = index;
  let depth = 0;
  for (; index < source.length; index++) {
    const char = source[index];
    if (char === "\\") {
      index++;
      continue;
    }
    if (angled) {
      if (char === ">") break;
    } else {
      if (char === "(") depth++;
      else if (char === ")") {
        if (!depth) break;
        depth--;
      } else if (/\s/.test(char)) break;
    }
  }
  return source.slice(0, start) + url + source.slice(index);
}
