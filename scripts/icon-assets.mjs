import { Resvg } from "@resvg/resvg-js";

export const iconSizes = [16, 24, 32, 48, 64, 128, 256];

export function straightRgba(pixels) {
  // tiny-skia/resvg exposes premultiplied RGBA. Windows DIB and Tauri Image
  // expect straight alpha; undo premultiplication to avoid dark edge halos.
  const rgba = Buffer.from(pixels);
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3];
    if (a > 0 && a < 255)
      for (let c = 0; c < 3; c++)
        rgba[i + c] = Math.min(255, Math.round((rgba[i + c] * 255) / a));
  }
  return rgba;
}

// Small Windows icons use BGRA DIBs plus an explicit 1-bit transparency mask.
// A 256px PNG keeps Explorer's large icon compact and preserves smooth alpha.
export function encodeDib(rgba, size) {
  const stride = Math.ceil(size / 32) * 4;
  const dib = Buffer.alloc(40 + size * size * 4 + stride * size);
  dib.writeUInt32LE(40, 0);
  dib.writeInt32LE(size, 4);
  dib.writeInt32LE(size * 2, 8);
  dib.writeUInt16LE(1, 12);
  dib.writeUInt16LE(32, 14);
  dib.writeUInt32LE(size * size * 4, 20);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const src = (y * size + x) * 4;
      const dst = 40 + ((size - 1 - y) * size + x) * 4;
      dib[dst] = rgba[src + 2];
      dib[dst + 1] = rgba[src + 1];
      dib[dst + 2] = rgba[src];
      dib[dst + 3] = rgba[src + 3];
      if (rgba[src + 3] === 0) {
        const mask = 40 + size * size * 4 + (size - 1 - y) * stride + (x >> 3);
        dib[mask] |= 0x80 >> (x & 7);
      }
    }
  }
  return dib;
}

export function createIconAssets(svg) {
  // Retain the approved symbol and Beta2's 82% scale, without a background.
  const padded = svg.replace(
    'viewBox="528 148 464 464"',
    'viewBox="477.073 97.073 565.854 565.854"',
  );
  const render = (size) =>
    new Resvg(padded, { fitTo: { mode: "width", value: size } }).render();
  const header = Buffer.alloc(6 + iconSizes.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(iconSizes.length, 4);
  const frames = [];
  let offset = header.length;
  for (const [i, size] of iconSizes.entries()) {
    const image = render(size);
    const rgba = straightRgba(image.pixels);
    const bytes =
      size === 256 ? Buffer.from(image.asPng()) : encodeDib(rgba, size);
    const entry = 6 + i * 16;
    header[entry] = size === 256 ? 0 : size;
    header[entry + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(bytes.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += bytes.length;
    frames.push({ size, bytes, rgba });
  }
  return {
    ico: Buffer.concat([header, ...frames.map((f) => f.bytes)]),
    png: Buffer.from(render(512).asPng()),
    windowRgba: frames.at(-1).rgba,
    frames,
  };
}
