import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const version = pkg.version,
  tag = "v" + version;
const bundle = "src-tauri/target/release/bundle/nsis";
const installer = fs
  .readdirSync(bundle)
  .find((name) => name.endsWith("-setup.exe") && name.includes(version));
if (!installer) throw new Error("Build the installer first.");
const signature = fs
  .readFileSync(path.join(bundle, installer + ".sig"), "utf8")
  .trim();
if (!signature) throw new Error("Missing updater signature.");
const notes = fs.readFileSync(`docs/RELEASE-${tag}.md`, "utf8").trim();
const manifest = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": {
      signature,
      url: `https://github.com/zeze49024/orvia-windows/releases/download/${tag}/${encodeURIComponent(installer)}`,
    },
  },
};
const release = path.join("release", tag);
fs.mkdirSync(release, { recursive: true });
fs.mkdirSync("updates/windows", { recursive: true });
for (const name of [installer, installer + ".sig"])
  fs.copyFileSync(path.join(bundle, name), path.join(release, name));
for (const file of [
  "updates/windows/latest.json",
  path.join(release, "latest.json"),
])
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n");
const names = [installer, installer + ".sig", "latest.json"];
fs.writeFileSync(
  path.join(release, "SHA256SUMS.txt"),
  names
    .map(
      (name) =>
        crypto
          .createHash("sha256")
          .update(fs.readFileSync(path.join(release, name)))
          .digest("hex") +
        "  " +
        name,
    )
    .join("\n") + "\n",
);
console.log(
  `Prepared ${tag}: installer, updater signature, update manifest and SHA256SUMS.txt.`,
);
