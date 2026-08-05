import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";

const migrationsDirectory = join(import.meta.dirname, "..", "migrations");

describe("migration transaction contract", () => {
  it("leaves transaction ownership to the migration runner", async () => {
    const files = (await readdir(migrationsDirectory)).filter((name) => name.endsWith(".sql"));
    assert.ok(files.length > 0);

    for (const file of files) {
      const sql = await readFile(join(migrationsDirectory, file), "utf8");
      assert.doesNotMatch(
        sql,
        /^\s*(?:BEGIN|COMMIT|ROLLBACK)\s*;/gim,
        `${file} must not control transactions; src/migrate.ts owns BEGIN/COMMIT`,
      );
    }
  });
});
