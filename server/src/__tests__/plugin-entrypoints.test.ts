import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolvePluginUiDir } from "../routes/plugin-ui-static.js";
import { resolvePluginPackageEntrypoint } from "../services/plugin-entrypoints.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-plugin-entrypoints-"));
  tempDirs.push(dir);
  return dir;
}

function writeFile(filePath: string, content = "export default null;\n"): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

describe("plugin entrypoint runtime confinement", () => {
  it("allows valid local-path worker entrypoints inside the package root", () => {
    const localPluginDir = makeTempDir();
    const packagePath = path.join(localPluginDir, "local-plugin");
    const workerPath = path.join(packagePath, "dist", "worker.js");
    writeFile(workerPath);

    expect(
      resolvePluginPackageEntrypoint(
        localPluginDir,
        "paperclip-plugin-local",
        "dist/worker.js",
        packagePath,
      ),
    ).toBe(workerPath);
  });

  it("rejects sibling-prefix worker traversal outside the package root", () => {
    const localPluginDir = makeTempDir();
    const packageRoot = path.join(localPluginDir, "node_modules", "paperclip-plugin-safe");
    const escapedWorker = path.join(
      localPluginDir,
      "node_modules",
      "paperclip-plugin-safe-evil",
      "dist",
      "worker.js",
    );
    writeFile(path.join(packageRoot, "package.json"), "{}\n");
    writeFile(escapedWorker);

    expect(
      resolvePluginPackageEntrypoint(
        localPluginDir,
        "paperclip-plugin-safe",
        "../paperclip-plugin-safe-evil/dist/worker.js",
      ),
    ).toBeNull();
  });

  it("rejects UI directory traversal for persisted local package paths", () => {
    const localPluginDir = makeTempDir();
    const packagePath = path.join(localPluginDir, "plugin-safe");
    const escapedUiDir = path.join(localPluginDir, "plugin-safe-evil", "dist", "ui");
    writeFile(path.join(packagePath, "package.json"), "{}\n");
    writeFile(path.join(escapedUiDir, "index.js"));

    expect(
      resolvePluginUiDir(
        localPluginDir,
        "paperclip-plugin-safe",
        "../plugin-safe-evil/dist/ui",
        packagePath,
      ),
    ).toBeNull();
  });

  it("supports direct-path UI packages that stay inside the package root", () => {
    const localPluginDir = makeTempDir();
    const uiDir = path.join(localPluginDir, "paperclip-plugin-direct", "dist", "ui");
    writeFile(path.join(uiDir, "index.js"));

    expect(
      resolvePluginUiDir(localPluginDir, "paperclip-plugin-direct", "dist/ui"),
    ).toBe(uiDir);
  });

  it("rejects symlinked UI directories that escape the package root", () => {
    const localPluginDir = makeTempDir();
    const packageRoot = path.join(localPluginDir, "node_modules", "paperclip-plugin-safe");
    const outsideUiDir = path.join(localPluginDir, "outside-ui");
    fs.mkdirSync(packageRoot, { recursive: true });
    fs.mkdirSync(outsideUiDir, { recursive: true });
    writeFile(path.join(outsideUiDir, "index.js"));
    fs.symlinkSync(outsideUiDir, path.join(packageRoot, "dist-ui"), "dir");

    expect(
      resolvePluginUiDir(localPluginDir, "paperclip-plugin-safe", "dist-ui"),
    ).toBeNull();
  });
});
