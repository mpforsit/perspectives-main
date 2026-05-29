import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { validatePerspective } from "../src/schemas";

const examplesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "examples");
const exampleFiles = readdirSync(examplesDir).filter((f) => f.endsWith(".json"));

describe("examples/*.json", () => {
  it("has at least one example", () => {
    expect(exampleFiles.length).toBeGreaterThan(0);
  });

  it.each(exampleFiles)("%s validates as a PerspectiveDef", (file) => {
    const raw = readFileSync(join(examplesDir, file), "utf8");
    const parsed: unknown = JSON.parse(raw);
    const result = validatePerspective(parsed);
    if (!result.ok) {
      throw new Error(
        `${file} failed validation:\n${JSON.stringify(result.errors.issues, null, 2)}`,
      );
    }
    expect(result.ok).toBe(true);
  });
});
