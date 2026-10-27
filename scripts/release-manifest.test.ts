import { afterEach, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const roots: string[] = [];
afterEach(() =>
  roots
    .splice(0)
    .forEach((root) => fs.rmSync(root, { recursive: true, force: true })),
);
function fixture(stable: boolean) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "orvia-manifest-test-"));
  roots.push(root);
  fs.mkdirSync(path.join(root, "src-tauri/target/release/bundle/nsis"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(root, "docs"));
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ version: "0.1.0" }),
  );
  fs.writeFileSync(path.join(root, "docs/RELEASE-v0.1.0.md"), "Stable notes");
  for (const version of stable
    ? ["0.1.0-beta1", "0.1.0-rc3", "0.1.0"]
    : ["0.1.0-beta1", "0.1.0-rc3"]) {
    const file = path.join(
      root,
      `src-tauri/target/release/bundle/nsis/Orvia_${version}_x64-setup.exe`,
    );
    fs.writeFileSync(file, version);
    fs.writeFileSync(file + ".sig", "signature-" + version);
  }
  const result = spawnSync(
    process.execPath,
    [path.resolve("scripts/release-manifest.mjs")],
    { cwd: root, encoding: "utf8" },
  );
  return { root, result };
}
test("stable manifest selects the exact installer when beta and rc bundles coexist", () => {
  const { root, result } = fixture(true);
  expect(result.status).toBe(0);
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, "updates/windows/latest.json"), "utf8"),
  );
  expect(manifest.platforms["windows-x86_64"].url).toMatch(
    /Orvia_0\.1\.0_x64-setup\.exe$/,
  );
  expect(manifest.platforms["windows-x86_64"].signature).toBe(
    "signature-0.1.0",
  );
  for (const channel of ["stable", "preview"]) {
    const feed = JSON.parse(
      fs.readFileSync(
        path.join(root, `updates/windows/${channel}.json`),
        "utf8",
      ),
    );
    expect(feed.version).toBe("0.1.0");
    expect(feed.platforms[channel]).toEqual(
      manifest.platforms["windows-x86_64"],
    );
  }
  expect(
    fs.readFileSync(
      path.join(root, "release/v0.1.0/Orvia_0.1.0_x64-setup.exe"),
      "utf8",
    ),
  ).toBe("0.1.0");
});
test("stable staging fails without the stable bundle instead of publishing a prerelease", () => {
  const { root, result } = fixture(false);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("Build the installer first");
  expect(fs.existsSync(path.join(root, "updates/windows/latest.json"))).toBe(
    false,
  );
});
