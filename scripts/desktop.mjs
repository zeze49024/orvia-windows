import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import os from "node:os";
const action = process.argv[2] ?? "dev";
if (!["dev", "build", "test"].includes(action))
  throw new Error("Expected dev, build or test");
const env = {
  ...process.env,
  PATH:
    path.join(os.homedir(), ".cargo", "bin") +
    path.delimiter +
    process.env.PATH,
};
if (process.platform === "win32") {
  const finder =
    "C:/Program Files (x86)/Microsoft Visual Studio/Installer/vswhere.exe";
  if (fs.existsSync(finder)) {
    const install = spawnSync(
      finder,
      [
        "-latest",
        "-products",
        "*",
        "-requires",
        "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
        "-property",
        "installationPath",
      ],
      { encoding: "utf8", windowsHide: true },
    ).stdout?.trim();
    if (install) {
      const batch = path.join(
        install,
        "VC",
        "Auxiliary",
        "Build",
        "vcvars64.bat",
      );
      const result = spawnSync(
        "cmd.exe",
        ["/d", "/s", "/c", `""${batch}" >nul && set"`],
        { encoding: "utf8", windowsHide: true, windowsVerbatimArguments: true },
      );
      if (result.status !== 0)
        throw new Error("Unable to initialize Visual C++ environment");
      for (const line of result.stdout.split(/\r?\n/)) {
        const split = line.indexOf("=");
        if (split > 0) env[line.slice(0, split)] = line.slice(split + 1);
      }
    }
  }
}
if (action === "build") {
  env.TAURI_SIGNING_PRIVATE_KEY ??= path.join(
    os.homedir(),
    ".orvia",
    "signing",
    "windows-updater.key",
  );
  if (!fs.existsSync(env.TAURI_SIGNING_PRIVATE_KEY))
    throw new Error("Updater signing key missing. See docs/DEVELOPMENT.md.");
}
const command = action === "test" ? "cargo" : process.execPath;
const args =
  action === "test"
    ? ["test", "--manifest-path", "src-tauri/Cargo.toml"]
    : [path.resolve("node_modules/@tauri-apps/cli/tauri.js"), action];
const child = spawn(command, args, {
  env,
  stdio: "inherit",
  windowsHide: true,
});
child.on("exit", (code) => process.exit(code ?? 1));
child.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});
