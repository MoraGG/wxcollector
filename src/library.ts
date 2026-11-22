/**
 * 本地镜像：把收到的内容写成人类可读、可同步的目录结构。
 *
 * <library>/
 * ├── 2026-11-21.md              当天的流水账（文字、语音转写、链接）
 * ├── 2026-11-21 标题.md          文章（全部平铺在根目录，不再按公众号分目录，2026-11-21 起）
 * ├── assets/                     所有文章配图（全库共用，md 里写 assets/<hash>.png）
 * ├── attachments/                图片、语音、文件、视频
 * └── index.md                    汇总索引（按天）
 */

import fs from "node:fs/promises";
import path from "node:path";

import { dateKey, getConfig, timeKey } from "./config.ts";
import { safeName } from "./media.ts";

export function libraryDir(): string {
  return getConfig().libraryDir;
}

export async function ensureLibrary(): Promise<void> {
  const root = libraryDir();
  await fs.mkdir(path.join(root, "assets"), { recursive: true });
  await fs.mkdir(path.join(root, "attachments"), { recursive: true });
}

/** 当天流水账文件的绝对路径 */
export function dailyNotePath(ts: number): string {
  return path.join(libraryDir(), `${dateKey(ts)}.md`);
}

/** 相对 library 根的路径，用于数据库记录与 OneDrive 映射 */
export function relativeToLibrary(abs: string): string {
  return path.relative(libraryDir(), abs).split(path.sep).join("/");
}

async function ensureFileHeader(file: string, ts: number): Promise<void> {
  try {
    await fs.access(file);
    return;
  } catch {
    /* 不存在，创建 */
  }
  const header = `---\ntype: wxcollector-daily\ndate: ${dateKey(ts)}\n---\n\n# ${dateKey(ts)}\n\n`;
  await fs.writeFile(file, header, "utf-8");
}

export type AppendEntry = {
  ts: number;
  /** text | voice | image | file | video | link | article */
  kind: string;
  text?: string;
  /** 附件相对路径（相对 library 根） */
  attachments?: string[];
  /** 链接 */
  url?: string;
  /** 文章笔记相对路径 */
  articlePath?: string;
  articleTitle?: string;
  /** 处理失败的说明 */
  note?: string;
};

const KIND_LABEL: Record<string, string> = {
  text: "文字",
  voice: "语音",
  image: "图片",
  file: "文件",
  video: "视频",
  link: "链接",
  article: "文章",
};

/**
 * 往当天流水账追加一条记录。返回写入的笔记相对路径。
 */
export async function appendToDaily(entry: AppendEntry): Promise<string> {
  const file = dailyNotePath(entry.ts);
  await ensureFileHeader(file, entry.ts);

  const lines: string[] = [];
  const label = KIND_LABEL[entry.kind] ?? entry.kind;
  lines.push(`## ${timeKey(entry.ts)} · ${label}`);
  lines.push("");

  if (entry.text) {
    // 多行文本用引用块，保证在流水账里视觉上是一整块
    for (const line of entry.text.split("\n")) {
      lines.push(`> ${line}`);
    }
    lines.push("");
  }

  if (entry.articleTitle && entry.articlePath) {
    lines.push(`📄 [[${entry.articlePath.replace(/\.md$/, "")}|${entry.articleTitle}]]`);
    lines.push("");
  }

  // 文章已抓取时，正文里的链接不再重复列出（文章笔记里已有原文地址）
  if (entry.url && !entry.articlePath) {
    lines.push(`🔗 ${entry.url}`);
    lines.push("");
  }

  if (entry.attachments?.length) {
    for (const a of entry.attachments) {
      lines.push(`- ![](${a})`);
    }
    lines.push("");
  }

  if (entry.note) {
    lines.push(`> ⚠️ ${entry.note}`);
    lines.push("");
  }

  lines.push("---");
  lines.push("");

  await fs.appendFile(file, lines.join("\n"), "utf-8");
  return relativeToLibrary(file);
}

/** 独立笔记（类似 WXLink 的 #单独保存） */
export async function writeStandaloneNote(ts: number, body: string): Promise<string> {
  const lines = body.split("\n");
  const firstLine = (lines[0] ?? "").trim();
  const title = safeName(firstLine.replace(/^#+\s*/, "").slice(0, 60) || "未命名");
  // 首行已作为标题和文件名，正文里不再重复
  const rest = lines.slice(1).join("\n").replace(/^\n+/, "").trim();
  const rel = path.join("notes", `${dateKey(ts)} ${title}.md`);
  const abs = path.join(libraryDir(), rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  const content =
    `---\ntype: wxcollector-note\ntitle: ${JSON.stringify(firstLine.replace(/^#+\s*/, ""))}\ncreated: ${new Date(ts).toISOString()}\n---\n\n` +
    `# ${firstLine.replace(/^#+\s*/, "")}\n\n` +
    (rest ? `${rest}\n` : "");
  await fs.writeFile(abs, content, "utf-8");
  return rel.split(path.sep).join("/");
}

export type ArticleWrite = {
  ts: number;
  title: string;
  author?: string;
  url: string;
  markdown: string;
  isWechat: boolean;
  /** 公众号名 / 站点名，用来建子目录 */
  source: string;
};

/**
 * 写一篇文章笔记，返回相对 library 根的路径。
 */
/** 预先算出文章将要落的目录，便于先下载图片再写文件 */
export function articlePaths(_source: string, _isWechat: boolean): { dirRel: string; dirAbs: string; assetsRel: string } {
  // 2026-11-21 起：文章一律平铺在 library 根目录，配图统一收进根目录的 assets/
  // （md 与 assets/ 同级，所以正文里写 `assets/<hash>.png` 就是正确相对路径）
  return {
    dirRel: "",
    dirAbs: libraryDir(),
    assetsRel: "assets",
  };
}

export async function writeArticleNote(a: ArticleWrite): Promise<{ rel: string; abs: string; assetsRel: string }> {
  const { dirRel, dirAbs, assetsRel } = articlePaths(a.source, a.isWechat);
  await fs.mkdir(dirAbs, { recursive: true });

  const base = safeName(a.title.slice(0, 80) || "未命名文章");
  let filename = `${dateKey(a.ts)} ${base}.md`;
  let abs = path.join(dirAbs, filename);
  // 同一天同名文章加序号
  let n = 2;
  while (true) {
    try {
      await fs.access(abs);
      filename = `${dateKey(a.ts)} ${base} (${n}).md`;
      abs = path.join(dirAbs, filename);
      n++;
    } catch {
      break;
    }
  }

  const front = [
    "---",
    `title: ${JSON.stringify(a.title)}`,
    a.author ? `author: ${JSON.stringify(a.author)}` : null,
    `source: ${JSON.stringify(a.url)}`,
    `type: ${a.isWechat ? "wechat-article" : "web-article"}`,
    `saved: ${new Date(a.ts).toISOString()}`,
    "---",
    "",
    `# ${a.title}`,
    "",
    a.url ? `> 原文：${a.url}` : null,
    a.author ? `> 作者：${a.author}` : null,
    "",
    a.markdown,
    "",
  ]
    .filter((x) => x !== null)
    .join("\n");

  await fs.writeFile(abs, front, "utf-8");
  return {
    rel: path.join(dirRel, filename).split(path.sep).join("/"),
    abs,
    assetsRel,
  };
}

/** 保存附件，返回相对路径 */
export async function saveAttachment(filename: string, buf: Buffer): Promise<string> {
  const dir = path.join(libraryDir(), "attachments", dateKey(Date.now()).slice(0, 7));
  await fs.mkdir(dir, { recursive: true });
  const abs = path.join(dir, filename);
  await fs.writeFile(abs, buf);
  return relativeToLibrary(abs);
}

/** 重建 index.md */
export async function rebuildIndex(): Promise<void> {
  const root = libraryDir();
  const entries = await fs.readdir(root, { withFileTypes: true });
  const days = entries
    .filter((e) => e.isFile() && /^\d{4}-\d{2}-\d{2}\.md$/.test(e.name))
    .map((e) => e.name.replace(/\.md$/, ""))
    .sort()
    .reverse();

  const lines = ["# 微信收集索引", "", `> 共 ${days.length} 天记录，更新于 ${new Date().toISOString()}`, ""];
  for (const d of days) {
    lines.push(`- [[${d}]]`);
  }
  lines.push("");
  await fs.writeFile(path.join(root, "index.md"), lines.join("\n"), "utf-8");
}

/** 统计本地镜像规模 */
export async function libraryStats(): Promise<{ files: number; bytes: number }> {
  let files = 0;
  let bytes = 0;
  async function walk(dir: string): Promise<void> {
    let items: Awaited<ReturnType<typeof fs.readdir>>;
    try {
      items = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const it of items) {
      const p = path.join(dir, it.name);
      if (it.isDirectory()) {
        await walk(p);
      } else if (it.isFile()) {
        files++;
        try {
          bytes += (await fs.stat(p)).size;
        } catch {
          /* ignore */
        }
      }
    }
  }
  await walk(libraryDir());
  return { files, bytes };
}
