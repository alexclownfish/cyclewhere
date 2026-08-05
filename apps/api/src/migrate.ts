import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const migrationsDirectory = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const files = (await readdir(migrationsDirectory)).filter((name) => name.endsWith(".sql")).sort();
const pool = new Pool({ connectionString: databaseUrl, max: 1 });
try {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  for (const file of files) {
    const applied = await pool.query("SELECT 1 FROM schema_migrations WHERE name=$1", [file]);
    if (applied.rowCount) continue;
    const sql = await readFile(join(migrationsDirectory, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations(name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      process.stdout.write(`applied ${file}\n`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
} finally {
  await pool.end();
}
