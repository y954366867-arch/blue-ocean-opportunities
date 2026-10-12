import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Product, Run } from "./schema";
import { createHash } from "node:crypto";
const path = resolve(process.env.DB_PATH || "./data/bot.sqlite");
mkdirSync(dirname(path), { recursive: true });
const db = new DatabaseSync(path);
db.exec(
  `PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS entities(kind TEXT NOT NULL,id TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(kind,id)); CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY AUTOINCREMENT,role TEXT NOT NULL,text TEXT NOT NULL,createdAt TEXT NOT NULL);`,
);
export function save(kind: string, id: string, value: unknown) {
  db.prepare("INSERT OR REPLACE INTO entities VALUES(?,?,?)").run(
    kind,
    id,
    JSON.stringify(value),
  );
}
export function get<T>(kind: string, id: string): T | null {
  const r = db
    .prepare("SELECT payload FROM entities WHERE kind=? AND id=?")
    .get(kind, id) as { payload: string } | undefined;
  return r ? JSON.parse(r.payload) : null;
}
export function list<T>(kind: string): T[] {
  return (
    db
      .prepare("SELECT payload FROM entities WHERE kind=? ORDER BY rowid DESC")
      .all(kind) as { payload: string }[]
  ).map((x) => JSON.parse(x.payload));
}
export function product() {
  return get<Product>("product", "current");
}
export function saveRun(run: Run) {
  const old = get<Run>("run", run.id);
  if (["queued", "running"].includes(run.status) && old?.cancelRequested)
    run.cancelRequested = true;
  run.updatedAt = new Date().toISOString();
  save("run", run.id, run);
  for (const n of run.dataset.notes) {
    const snapshot = {
      noteId: n.id,
      runId: run.id,
      collectedAt: n.collectedAt || run.dataset.provenance.collectedAt,
      metrics: n.metrics,
      raw: n.metricsRaw || null,
    };
    const hash = createHash("sha256")
      .update(JSON.stringify(snapshot))
      .digest("hex")
      .slice(0, 20);
    save("metric-snapshot", hash, snapshot);
  }
}
export function message(role: string, text: string) {
  db.prepare("INSERT INTO messages(role,text,createdAt) VALUES(?,?,?)").run(
    role,
    text,
    new Date().toISOString(),
  );
}
export function messages() {
  return db
    .prepare(
      "SELECT role,text,createdAt FROM (SELECT * FROM messages ORDER BY id DESC LIMIT 60) ORDER BY id",
    )
    .all();
}
