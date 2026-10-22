/** Decode only explicit Unicode encodings. Never silently import replacement characters. */
export function decodeTextFile(bytes: Uint8Array) {
  let encoding = "utf-8";
  if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = "utf-16le";
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = "utf-16be";
  try {
    const text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
    if (text.includes("\0")) throw new Error("BINARY_TEXT");
    return text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  } catch {
    throw new Error("TEXT_ENCODING_UNSUPPORTED");
  }
}
