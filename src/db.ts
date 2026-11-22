import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { DATA_DIR, DB_PATH } from "./config.ts";

export type MessageRow = {
  id: number;
  msg_id: string;
  from_user_id: string;
  direction: string;
  kind: string;
  text: string | null;
  context_token: string | null;
  created_at: number;
  note_path: string | null;
  status: string;
  error: string | null;
};

export type AssetRow = {
  id: number;
  message_id: number;
  local_path: string;
  remote_path: string | null;
  filename: string;
  size: number;
  sha256: string | null;
  upload_status: string;
  error: string | null;
  created_at: number;
};

export type ArticleRow = {
  id: number;
  message_id: number;
  url: string;
  title: string | null;
  author: string | null;
  local_path: string | null;
  status: string;
  error: string | null;
  created_at: number;
};

fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(DB_PATH);

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS messages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  msg_id        TEXT UNIQUE NOT NULL,
  from_user_id  TEXT NOT NULL,
  direction     TEXT NOT NULL DEFAULT 'in',
  kind          TEXT NOT NULL DEFAULT 'text',
  text          TEXT,
  context_token TEXT,
  created_at    INTEGER NOT NULL,
  note_path     TEXT,
  status        TEXT NOT NULL DEFAULT 'new',
  error         TEXT
);

CREATE TABLE IF NOT EXISTS assets (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id    INTEGER NOT NULL,
  local_path    TEXT NOT NULL,
  remote_path   TEXT,
  filename      TEXT NOT NULL,
  size          INTEGER NOT NULL DEFAULT 0,
  sha256        TEXT,
  upload_status TEXT NOT NULL DEFAULT 'pending',
  error         TEXT,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS articles (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL,
  url        TEXT NOT NULL,
  title      TEXT,
  author     TEXT,
  local_path TEXT,
  status     TEXT NOT NULL DEFAULT 'pending',
  error      TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS kv (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(upload_status);
CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(status);
`);

// ---------------------------------------------------------------- kv helpers

export function kvGet(k: string): string | null {
  const row = db.prepare("SELECT v FROM kv WHERE k = ?").get(k) as { v: string } | undefined;
  return row?.v ?? null;
}

export function kvSet(k: string, v: string): void {
  db.prepare("INSERT INTO kv(k, v) VALUES(?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").run(k, v);
}

export function kvDel(k: string): void {
  db.prepare("DELETE FROM kv WHERE k = ?").run(k);
}

// ------------------------------------------------------------ message helpers

export function insertMessage(m: {
  msg_id: string;
  from_user_id: string;
  kind: string;
  text: string | null;
  context_token: string | null;
  created_at: number;
  direction?: string;
}): number | null {
  const existing = db.prepare("SELECT id FROM messages WHERE msg_id = ?").get(m.msg_id);
  if (existing) return null; // 幂等：重放游标时不会重复入库
  const r = db
    .prepare(
      `INSERT INTO messages(msg_id, from_user_id, direction, kind, text, context_token, created_at)
       VALUES(?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      m.msg_id,
      m.from_user_id,
      m.direction ?? "in",
      m.kind,
      m.text,
      m.context_token,
      m.created_at,
    );
  return Number(r.lastInsertRowid);
}

export function updateMessage(
  id: number,
  patch: { note_path?: string; status?: string; error?: string | null },
): void {
  const sets: string[] = [];
  const vals: (string | null)[] = [];
  if (patch.note_path !== undefined) {
    sets.push("note_path = ?");
    vals.push(patch.note_path);
  }
  if (patch.status !== undefined) {
    sets.push("status = ?");
    vals.push(patch.status);
  }
  if (patch.error !== undefined) {
    sets.push("error = ?");
    vals.push(patch.error);
  }
  if (!sets.length) return;
  vals.push(String(id));
  db.prepare(`UPDATE messages SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
}

export function recentMessages(limit = 100): MessageRow[] {
  return db
    .prepare("SELECT * FROM messages ORDER BY created_at DESC LIMIT ?")
    .all(limit) as MessageRow[];
}

// -------------------------------------------------------------- asset helpers

export function insertAsset(a: {
  message_id: number;
  local_path: string;
  filename: string;
  size: number;
  sha256?: string;
  upload_status?: string;
}): number {
  const r = db
    .prepare(
      `INSERT INTO assets(message_id, local_path, filename, size, sha256, upload_status, created_at)
       VALUES(?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      a.message_id,
      a.local_path,
      a.filename,
      a.size,
      a.sha256 ?? null,
      a.upload_status ?? "pending",
      Date.now(),
    );
  return Number(r.lastInsertRowid);
}

export function pendingAssets(limit = 20): AssetRow[] {
  return db
    .prepare("SELECT * FROM assets WHERE upload_status IN ('pending','failed') ORDER BY id ASC LIMIT ?")
    .all(limit) as AssetRow[];
}

export function setAssetStatus(
  id: number,
  status: string,
  remotePath?: string | null,
  error?: string | null,
): void {
  db.prepare("UPDATE assets SET upload_status = ?, remote_path = COALESCE(?, remote_path), error = ? WHERE id = ?").run(
    status,
    remotePath ?? null,
    error ?? null,
    id,
  );
}

export function assetStats(): Record<string, number> {
  const rows = db.prepare("SELECT upload_status AS s, COUNT(*) AS c FROM assets GROUP BY upload_status").all() as {
    s: string;
    c: number;
  }[];
  const out: Record<string, number> = { pending: 0, uploading: 0, done: 0, failed: 0, skipped: 0 };
  for (const r of rows) out[r.s] = r.c;
  return out;
}

// ------------------------------------------------------------ article helpers

export function insertArticle(a: {
  message_id: number;
  url: string;
  status?: string;
}): number {
  const r = db
    .prepare("INSERT INTO articles(message_id, url, status, created_at) VALUES(?, ?, ?, ?)")
    .run(a.message_id, a.url, a.status ?? "pending", Date.now());
  return Number(r.lastInsertRowid);
}

export function updateArticle(
  id: number,
  patch: { title?: string; author?: string; local_path?: string; status?: string; error?: string | null },
): void {
  const sets: string[] = [];
  const vals: (string | null)[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    sets.push(`${k} = ?`);
    vals.push(v as string | null);
  }
  if (!sets.length) return;
  vals.push(String(id));
  db.prepare(`UPDATE articles SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
}

export function recentArticles(limit = 50): ArticleRow[] {
  return db.prepare("SELECT * FROM articles ORDER BY created_at DESC LIMIT ?").all(limit) as ArticleRow[];
}

export function retryFailedAssets(): number {
  const r = db.prepare("UPDATE assets SET upload_status='pending', error=NULL WHERE upload_status='failed'").run();
  return Number(r.changes);
}
