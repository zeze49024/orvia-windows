import { strFromU8 } from "fflate";
import type { Asset } from "./model";
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
