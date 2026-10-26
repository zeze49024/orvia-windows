import { imageMime } from "./image-mime";
export const IMAGE_PIXEL_LIMIT = 40_000_000;
export function imageDimensions(bytes: Uint8Array) {
  const mime = imageMime(bytes),
    v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0,
    height = 0;
  if (mime === "image/png" && bytes.length >= 24) {
    width = v.getUint32(16);
    height = v.getUint32(20);
  } else if (mime === "image/gif" && bytes.length >= 10) {
    width = v.getUint16(6, true);
    height = v.getUint16(8, true);
  } else if (mime === "image/webp" && bytes.length >= 30) {
    const tag = new TextDecoder().decode(bytes.slice(12, 16));
    if (tag === "VP8X") {
      width = 1 + bytes[24] + bytes[25] * 256 + bytes[26] * 65536;
      height = 1 + bytes[27] + bytes[28] * 256 + bytes[29] * 65536;
    } else if (tag === "VP8 ") {
      width = v.getUint16(26, true) & 16383;
      height = v.getUint16(28, true) & 16383;
    } else if (tag === "VP8L" && bytes[20] === 47) {
      width = 1 + bytes[21] + ((bytes[22] & 63) << 8);
      height =
        1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 15) << 10);
    }
  } else if (mime === "image/jpeg") {
    let i = 2;
    while (i + 3 < bytes.length) {
      if (bytes[i++] !== 255) throw new Error("INVALID_IMAGE");
      while (bytes[i] === 255) i++;
      const marker = bytes[i++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      const n = v.getUint16(i);
      if (n < 2 || i + n > bytes.length) throw new Error("INVALID_IMAGE");
      if (
        [
          192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207,
        ].includes(marker) &&
        n >= 7
      ) {
        height = v.getUint16(i + 3);
        width = v.getUint16(i + 5);
        break;
      }
      i += n;
    }
  }
  if (
    !width ||
    !height ||
    width > 16384 ||
    height > 16384 ||
    width * height > IMAGE_PIXEL_LIMIT
  )
    throw new Error("IMAGE_PIXEL_LIMIT");
  return { mime, width, height };
}
export async function validateImage(bytes: Uint8Array) {
  const dimensions = imageDimensions(bytes);
  if (typeof createImageBitmap !== "function") return dimensions;
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const decoded = createImageBitmap(
    new Blob([new Uint8Array(bytes).buffer], { type: dimensions.mime }),
  );
  try {
    const bitmap = await Promise.race([
      decoded.then((bitmap) => {
        if (expired) bitmap.close();
        return bitmap;
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          expired = true;
          reject(new Error("IMAGE_DECODE_TIMEOUT"));
        }, 8000);
      }),
    ]);
    try {
      if (bitmap.width * bitmap.height > IMAGE_PIXEL_LIMIT)
        throw new Error("IMAGE_PIXEL_LIMIT");
      return dimensions;
    } finally {
      bitmap.close();
    }
  } finally {
    clearTimeout(timer);
  }
}
