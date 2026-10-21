import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { createIconAssets, iconSizes, straightRgba } from "./icon-assets.mjs";
const assets = createIconAssets(
  readFileSync(
    new URL("../public/brand/orvia-symbol.svg", import.meta.url),
    "utf8",
  ),
);

describe("Windows icon transparency", () => {
  it("unpremultiplies translucent edges without changing alpha or opaque colors", () => {
    expect([
      ...straightRgba(
        Buffer.from([8, 8, 8, 48, 10, 10, 11, 63, 38, 39, 41, 255, 0, 0, 0, 0]),
      ),
    ]).toEqual([43, 43, 43, 48, 40, 40, 45, 63, 38, 39, 41, 255, 0, 0, 0, 0]);
  });
  it("retains matching alpha and AND masks at every small Windows icon size", () => {
    expect(assets.ico.readUInt16LE(4)).toBe(iconSizes.length);
    for (const frame of assets.frames.filter((f) => f.size < 256)) {
      const { size, bytes, rgba } = frame;
      expect(bytes.readInt32LE(8)).toBe(size * 2);
      expect(bytes.readUInt16LE(14)).toBe(32);
      const stride = Math.ceil(size / 32) * 4;
      let clear = 0,
        visible = 0,
        translucent = 0;
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
          const original = (y * size + x) * 4;
          const stored = 40 + ((size - 1 - y) * size + x) * 4;
          const alpha = bytes[stored + 3];
          expect([
            bytes[stored + 2],
            bytes[stored + 1],
            bytes[stored],
            alpha,
          ]).toEqual([...rgba.subarray(original, original + 4)]);
          const mask =
            bytes[40 + size * size * 4 + (size - 1 - y) * stride + (x >> 3)] &
            (0x80 >> (x & 7));
          expect(Boolean(mask)).toBe(alpha === 0);
          if (alpha === 0) clear++;
          else visible++;
          if (alpha > 0 && alpha < 255) translucent++;
        }
      expect(clear).toBeGreaterThan((size * size) / 2);
      expect(visible).toBeGreaterThan(0);
      expect(translucent).toBeGreaterThan(0);
      expect(rgba[3]).toBe(0);
    }
  });
  it("retains transparent RGBA for the running window and PNG for large icons", () => {
    expect(assets.frames.at(-1).bytes.subarray(0, 8)).toEqual(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    expect(assets.windowRgba.length).toBe(256 * 256 * 4);
    expect(assets.windowRgba[3]).toBe(0);
    expect(assets.windowRgba[(128 * 256 + 128) * 4 + 3]).toBe(0);
    expect(assets.windowRgba.some((v, i) => i % 4 === 3 && v === 255)).toBe(
      true,
    );
  });
});
