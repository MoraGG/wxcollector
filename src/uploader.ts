/**
 * OneDrive 上传器：定时扫描本地镜像，把新增/改动的文件推上去。
 *
 * 用 (路径, 内容哈希) 做去重，所以重跑、重启、重复触发都不会重复上传。
 * 上传是异步的，绝不阻塞收消息的主循环——收到消息后只是 notifyUploader() 叫醒它。
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { getConfig } from "./config.ts";
import { db } from "./db.ts";
import { libraryDir } from "./library.ts";
import { hasRefreshToken, uploadFile } from "./onedrive.ts";

db.exec(`
CREATE TABLE IF NOT EXISTS uploads (
  rel       TEXT PRIMARY KEY,
  sha256    TEXT NOT NULL,
  size      INTEGER NOT NULL,
  status    TEXT NOT NULL DEFAULT 'done',
  error     TEXT,
  uploaded_at INTEGER NOT NULL
);
`);

export type UploadRecord = {
  rel: string;
  sha256: string;
  size: number;
  status: string;
  error: string | null;
  uploaded_at: number;
};

let wake: (() => void) | null = null;
let running = false;
let timer: NodeJS.Timeout | null = null;

export type UploaderStatus = {
  enabled: boolean;
  loggedIn: boolean;
  running: boolean;
  lastRunAt: number | null;
  lastError: string | null;
  lastUploaded: number;
  totalUploaded: number;
};

/** 判断是否是鉴权失败（令牌失效 / 应用配置错误），这类错误重试无意义 */
function isAuthError(msg: string): boolean {
  return (
    /\b401\b/.test(msg) ||
    /AADSTS\d+/.test(msg) ||
    /invalid_grant|invalid_client|unauthorized|InvalidAuthenticationToken/i.test(msg) ||
    /未登录|重新登录/.test(msg)
  );
}

/** 本轮是否因鉴权失败中断，用于前端提示 */
let authBroken = false;

const status: UploaderStatus = {
  enabled: false,
  loggedIn: false,
  running: false,
  lastRunAt: null,
  lastError: null,
  lastUploaded: 0,
  totalUploaded: 0,
};

export function uploaderStatus(): UploaderStatus & { authBroken: boolean } {
  const cfg = getConfig();
  return {
    ...status,
    enabled: cfg.onedrive.enabled,
    loggedIn: hasRefreshToken() && !authBroken,
    authBroken,
  };
}

/** 收到新内容时叫醒上传器 */
export function notifyUploader(): void {
  wake?.();
}

function sha256(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

/** 递归列出 library 里所有文件（跳过隐藏文件和 index.md 以外的元数据） */
async function listFiles(): Promise<string[]> {
  const root = libraryDir();
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let items: Awaited<ReturnType<typeof fs.readdir>>;
    try {
      items = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const it of items) {
      if (it.name.startsWith(".")) continue;
      const p = path.join(dir, it.name);
      if (it.isDirectory()) {
        await walk(p);
      } else if (it.isFile()) {
        out.push(path.relative(root, p).split(path.sep).join("/"));
      }
    }
  }
  await walk(root);
  return out;
}

function getRecord(rel: string): UploadRecord | undefined {
  return db.prepare("SELECT * FROM uploads WHERE rel = ?").get(rel) as UploadRecord | undefined;
}

function setRecord(rel: string, hash: string, size: number, st: string, error: string | null): void {
  db.prepare(
    `INSERT INTO uploads(rel, sha256, size, status, error, uploaded_at)
     VALUES(?, ?, ?, ?, ?, ?)
     ON CONFLICT(rel) DO UPDATE SET
       sha256 = excluded.sha256, size = excluded.size,
       status = excluded.status, error = excluded.error, uploaded_at = excluded.uploaded_at`,
  ).run(rel, hash, size, st, error, Date.now());
}

export function pendingUploadCount(): number {
  return Number(
    (db.prepare("SELECT COUNT(*) AS c FROM uploads WHERE status = 'failed'").get() as { c: number }).c,
  );
}

export function recentUploads(limit = 30): UploadRecord[] {
  return db.prepare("SELECT * FROM uploads ORDER BY uploaded_at DESC LIMIT ?").all(limit) as UploadRecord[];
}

/** 跑一轮同步 */
export async function syncOnce(force = false): Promise<{ uploaded: number; skipped: number; failed: number; error?: string }> {
  if (running) return { uploaded: 0, skipped: 0, failed: 0, error: "上一轮还在进行" };
  running = true;
  authBroken = false;
  status.running = true;
  status.lastRunAt = Date.now();
  status.lastError = null;

  let uploaded = 0;
  let skipped = 0;
  let failed = 0;

  try {
    if (!hasRefreshToken()) throw new Error("未登录 OneDrive");

    const files = await listFiles();
    for (const rel of files) {
      const abs = path.join(libraryDir(), rel);
      let buf: Buffer;
      try {
        buf = await fs.readFile(abs);
      } catch {
        continue;
      }
      const hash = sha256(buf);
      const rec = getRecord(rel);
      if (!force && rec && rec.sha256 === hash && rec.status === "done") {
        skipped++;
        continue;
      }

      try {
        await uploadFile(abs, rel);
        setRecord(rel, hash, buf.length, "done", null);
        uploaded++;
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        setRecord(rel, hash, buf.length, "failed", m);
        failed++;
        status.lastError = m;
        // 鉴权类错误：剩下的文件必然也失败，立刻中断整轮并标记需要重新登录
        if (isAuthError(m)) {
          authBroken = true;
          status.loggedIn = false;
          break;
        }
      }
    }

    status.lastUploaded = uploaded;
    status.totalUploaded += uploaded;
    return { uploaded, skipped, failed };
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    status.lastError = m;
    return { uploaded, skipped, failed, error: m };
  } finally {
    running = false;
    status.running = false;
    // 鉴权失败时即使本地还有 refresh_token 也不能算登录有效
    status.loggedIn = hasRefreshToken() && !authBroken;
  }
}

/** 启动后台循环 */
export function startUploader(): void {
  const cfg = getConfig();
  if (!cfg.onedrive.enabled) return;
  if (timer) clearInterval(timer);

  const tick = async (): Promise<void> => {
    if (!getConfig().onedrive.enabled) return;
    if (!hasRefreshToken()) return;
    await syncOnce();
  };

  // 首次延迟 5 秒，避免和启动抢资源
  setTimeout(() => void tick(), 5_000);

  const interval = Math.max(10, getConfig().upload.intervalSec) * 1000;
  timer = setInterval(() => void tick(), interval);

  // 唤醒机制：收到新消息时插队跑一轮（防抖，避免连续消息打爆）
  let debounce: NodeJS.Timeout | null = null;
  wake = () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = null;
      if (!running) void tick();
    }, 1500);
  };
}

export function stopUploader(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  wake = null;
}

/** 把失败记录重置，等待重传 */
export function retryFailedUploads(): number {
  const r = db.prepare("UPDATE uploads SET status='failed', sha256='' WHERE status='failed'").run();
  return Number(r.changes);
}
