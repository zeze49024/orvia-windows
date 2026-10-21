import fs from "node:fs";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";
fs.mkdirSync("src-tauri/icons", { recursive: true });
// Transparent padding scales the approved symbol to 82% of the icon canvas.
const iconSvg = fs
  .readFileSync("public/brand/orvia-symbol.svg", "utf8")
  .replace(
    'viewBox="528 148 464 464"',
    'viewBox="477.073 97.073 565.854 565.854"',
  );
fs.writeFileSync(
  "src-tauri/icons/icon.png",
  new Resvg(iconSvg, {
    fitTo: { mode: "width", value: 512 },
  })
    .render()
    .asPng(),
);
const sizes = [16, 24, 32, 48, 64, 128, 256],
  header = Buffer.alloc(6),
  entries = [],
  images = [];
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = 6 + 16 * sizes.length;
for (const size of sizes) {
  const png = Buffer.from(
    new Resvg(iconSvg, {
      fitTo: { mode: "width", value: size },
    })
      .render()
      .asPng(),
  );
  const entry = Buffer.alloc(16);
  entry[0] = size === 256 ? 0 : size;
  entry[1] = size === 256 ? 0 : size;
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(offset, 12);
  offset += png.length;
  entries.push(entry);
  images.push(png);
}
fs.writeFileSync(
  "src-tauri/icons/icon.ico",
  Buffer.concat([header, ...entries, ...images]),
);
fs.mkdirSync("public/pdf", { recursive: true });
for (const name of ["cmaps", "standard_fonts", "wasm"])
  fs.cpSync(
    path.join("node_modules/pdfjs-dist", name),
    path.join("public/pdf", name),
    { recursive: true },
  );
const notices = [
  "Orvia third-party software notices",
  "Generated from installed npm packages. Each dependency retains its own license.",
  "",
];
const lock = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
for (const [location, metadata] of Object.entries(lock.packages ?? {})) {
  if (!location || metadata.dev || metadata.optional) continue;
  const file = path.join(location, "package.json");
  if (!fs.existsSync(file)) continue;
  const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
  notices.push(
    `${pkg.name}@${pkg.version} — ${typeof pkg.license === "string" ? pkg.license : JSON.stringify(pkg.license ?? "See package license")}`,
  );
  const license = fs
    .readdirSync(location)
    .find((name) => /^licen[cs]e(\.|$)/i.test(name));
  if (license && fs.statSync(path.join(location, license)).isFile())
    notices.push(fs.readFileSync(path.join(location, license), "utf8"));
  notices.push("");
}
fs.writeFileSync("public/third-party-notices.txt", notices.join("\n"));
console.log("Prepared local PDF resources, app icon and third-party notices.");
