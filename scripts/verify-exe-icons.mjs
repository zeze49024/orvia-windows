import fs from "node:fs";
import assert from "node:assert/strict";
import { createIconAssets } from "./icon-assets.mjs";

// Inspect RT_ICON resources in the actual shipped PE, not just source images.
const binary = fs.readFileSync(
  process.argv[2] ?? "src-tauri/target/release/orvia.exe",
);
const expected = createIconAssets(
  fs.readFileSync("public/brand/orvia-symbol.svg", "utf8"),
);
const pe = binary.readUInt32LE(60),
  optional = pe + 24;
assert.equal(binary.toString("ascii", pe, pe + 4), "PE\0\0");
const directory =
  optional + (binary.readUInt16LE(optional) === 0x20b ? 112 : 96);
const sections = [];
for (let i = 0; i < binary.readUInt16LE(pe + 6); i++) {
  const section = optional + binary.readUInt16LE(pe + 20) + i * 40;
  sections.push({
    virtual: binary.readUInt32LE(section + 12),
    size: Math.max(
      binary.readUInt32LE(section + 8),
      binary.readUInt32LE(section + 16),
    ),
    raw: binary.readUInt32LE(section + 20),
  });
}
const at = (rva) => {
  const section = sections.find(
    (s) => rva >= s.virtual && rva < s.virtual + s.size,
  );
  assert(section, "RVA is outside PE sections");
  return section.raw + rva - section.virtual;
};
const root = at(binary.readUInt32LE(directory + 16));
const entries = (offset) => {
  const dir = root + offset,
    count = binary.readUInt16LE(dir + 12) + binary.readUInt16LE(dir + 14);
  return Array.from({ length: count }, (_, i) => ({
    id: binary.readUInt32LE(dir + 16 + i * 8),
    offset: binary.readUInt32LE(dir + 20 + i * 8),
  }));
};
const type = entries(0).find((entry) => entry.id === 3);
assert(type, "No icon resources");
const resources = entries(type.offset & 0x7fffffff);
assert.equal(resources.length, expected.frames.length);
for (const [index, resource] of resources.entries()) {
  for (const language of entries(resource.offset & 0x7fffffff)) {
    const data = root + language.offset;
    const start = at(binary.readUInt32LE(data)),
      length = binary.readUInt32LE(data + 4);
    assert.deepEqual(
      binary.subarray(start, start + length),
      expected.frames[index].bytes,
      `Stale or altered ${expected.frames[index].size}px icon in executable`,
    );
  }
}
assert(
  binary.includes(expected.windowRgba),
  "Explicit transparent window icon missing from executable",
);
console.log(
  "Verified all 7 PE icon resources and explicit RGBA window icon in the executable.",
);
