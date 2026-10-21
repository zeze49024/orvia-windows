import fs from "node:fs";
import path from "node:path";
import { createIconAssets } from "./icon-assets.mjs";
fs.mkdirSync("src-tauri/icons", { recursive: true });
const icons = createIconAssets(
  fs.readFileSync("public/brand/orvia-symbol.svg", "utf8"),
);
fs.writeFileSync("src-tauri/icons/icon.png", icons.png);
fs.writeFileSync("src-tauri/icons/icon.ico", icons.ico);
fs.writeFileSync("src-tauri/icons/window-icon.rgba", icons.windowRgba);
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
