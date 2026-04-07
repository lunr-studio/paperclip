import { describe, expect, it } from "vitest";
import { pluginManifestV1Schema, isValidPluginEntrypointPath } from "./plugin.js";

const baseManifest = {
  id: "acme.plugin",
  apiVersion: 1 as const,
  version: "1.0.0",
  displayName: "Acme Plugin",
  description: "Example plugin for validator coverage",
  author: "Lunr Studio",
  categories: ["connector"] as const,
  capabilities: ["companies.read"] as const,
};

describe("plugin entrypoint validation", () => {
  it("accepts package-relative worker and UI entrypoints", () => {
    expect(() =>
      pluginManifestV1Schema.parse({
        ...baseManifest,
        entrypoints: {
          worker: "dist/worker.js",
          ui: "./dist/ui/",
        },
      }),
    ).not.toThrow();
  });

  it("rejects absolute or escaping worker entrypoints", () => {
    for (const entrypoint of [
      "/tmp/worker.js",
      "../worker.js",
      "dist/../../evil.js",
      "C:\\evil.js",
      "\\\\server\\share\\worker.js",
    ]) {
      const result = pluginManifestV1Schema.safeParse({
        ...baseManifest,
        entrypoints: { worker: entrypoint },
      });

      expect(result.success, entrypoint).toBe(false);
    }
  });

  it("rejects absolute or escaping UI entrypoints", () => {
    for (const entrypoint of [
      "/tmp/ui",
      "../ui",
      "dist/../../ui",
      "C:\\ui",
      "//server/share/ui",
    ]) {
      const result = pluginManifestV1Schema.safeParse({
        ...baseManifest,
        entrypoints: {
          worker: "dist/worker.js",
          ui: entrypoint,
        },
      });

      expect(result.success, entrypoint).toBe(false);
    }
  });

  it("exposes the same helper used by the manifest schema", () => {
    expect(isValidPluginEntrypointPath("dist/worker.js")).toBe(true);
    expect(isValidPluginEntrypointPath("./dist/ui/")).toBe(true);
    expect(isValidPluginEntrypointPath("../worker.js")).toBe(false);
    expect(isValidPluginEntrypointPath("C:\\worker.js")).toBe(false);
  });
});
