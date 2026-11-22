/**
 * 消息处理流水线：一条微信消息 → 本地镜像 → 上传队列。
 *
 * 顺序刻意这样设计：
 *   1. 先落本地（附件立刻下载，因为微信 CDN 链接会过期）
 *   2. 再抓文章（可能慢，失败不影响文字）
 *   3. 最后写流水账
 *   4. 上传交给独立的 uploader 轮询，收到消息的主循环绝不阻塞在网络上
 */

import path from "node:path";

import { fetchArticle, extractUrls, localizeImages } from "./article.ts";
import { getConfig, dateKey, timeKey } from "./config.ts";
import { insertArticle, insertAsset, insertMessage, updateArticle, updateMessage } from "./db.ts";
import {
  extractText,
  MessageItemType,
  type WeixinMessage,
  type MessageItem,
} from "./ilink.ts";
import {
  appendToDaily,
  articlePaths,
  saveAttachment,
  writeArticleNote,
  writeStandaloneNote,
} from "./library.ts";
import { downloadAllMedia, type DownloadedMedia } from "./media.ts";
import { notifyUploader } from "./uploader.ts";

const STANDALONE_TRIGGER = "#单独保存";

export type ProcessResult = {
  kind: string;
  notePath?: string;
  articlePath?: string;
  reply: string;
  ok: boolean;
};

function stampOf(ts: number): string {
  return `${dateKey(ts)}-${timeKey(ts).replace(":", "")}`;
}

function detectKind(items: MessageItem[] | undefined, text: string): string {
  if (items?.some((i) => i.type === MessageItemType.IMAGE)) return "image";
  if (items?.some((i) => i.type === MessageItemType.VOICE)) return "voice";
  if (items?.some((i) => i.type === MessageItemType.FILE)) return "file";
  if (items?.some((i) => i.type === MessageItemType.VIDEO)) return "video";
  if (extractUrls(text).length) return "link";
  return "text";
}

/** 稳定 msg_id：微信没给时用内容哈希兜底，保证幂等 */
function stableMsgId(msg: WeixinMessage, idx: number): string {
  if (msg.message_id != null) return `m${msg.message_id}`;
  if (msg.seq != null) return `s${msg.seq}`;
  const base = `${msg.from_user_id}|${msg.create_time_ms}|${extractText(msg.item_list)}|${idx}`;
  return `h${Buffer.from(base).toString("base64url").slice(0, 32)}`;
}

export async function processMessage(msg: WeixinMessage, idx: number): Promise<ProcessResult | null> {
  const cfg = getConfig();
  const from = msg.from_user_id ?? "";
  if (!from) return null;

  // 跳过机器人自己发的
  if (msg.message_type === 2) return null;

  const ts = msg.create_time_ms && msg.create_time_ms > 1e12 ? msg.create_time_ms : Date.now();
  const text = extractText(msg.item_list);
  const kind = detectKind(msg.item_list, text);
  const msgId = stableMsgId(msg, idx);

  const rowId = insertMessage({
    msg_id: msgId,
    from_user_id: from,
    kind,
    text: text || null,
    context_token: msg.context_token ?? null,
    created_at: ts,
  });
  if (rowId === null) {
    return null; // 已处理过
  }

  try {
    // ---------------------------------------------------------- 1. 附件
    const attachments: string[] = [];
    const stamp = stampOf(ts);
    let media: DownloadedMedia[] = [];
    if (msg.item_list?.length) {
      media = await downloadAllMedia(msg.item_list, stamp);
    }

    for (const m of media) {
      if (!m.buffer.length) continue;
      const rel = await saveAttachment(m.filename, m.buffer);
      attachments.push(rel);
      insertAsset({
        message_id: rowId,
        local_path: path.join(cfg.libraryDir, rel),
        filename: path.basename(rel),
        size: m.buffer.length,
      });
    }

    // 语音转写文字补充到正文
    let body = text;
    if (!body) {
      const transcript = media.find((m) => m.transcript)?.transcript;
      if (transcript) body = transcript;
    }

    // ---------------------------------------------------------- 2. 文章
    let articlePath: string | undefined;
    let articleTitle: string | undefined;
    let articleError: string | undefined;

    const urls = extractUrls(body);
    if (cfg.article.enabled && urls.length) {
      for (const url of urls.slice(0, 3)) {
        const artRowId = insertArticle({ message_id: rowId, url });
        const r = await fetchArticle(url);
        if (!r.ok) {
          updateArticle(artRowId, { status: "failed", error: r.reason });
          articleError = r.reason;
          continue;
        }

        const a = r.article;
        const source = a.isWechat ? a.author || "微信公众号" : a.siteName || new URL(url).hostname;

        // 先把图片下载到目标 assets 目录，再写笔记 —— 避免写完再改文件
        const dirs = articlePaths(source, a.isWechat);
        const loc = await localizeImages(
          a.markdown,
          a.imageUrls,
          path.join(cfg.libraryDir, dirs.assetsRel),
          "assets",
        );

        const written = await writeArticleNote({
          ts,
          title: a.title,
          author: a.author,
          url,
          markdown: loc.markdown,
          isWechat: a.isWechat,
          source,
        });

        updateArticle(artRowId, {
          title: a.title,
          author: a.author ?? "",
          local_path: written.rel,
          status: "done",
          error: null,
        });
        articlePath = written.rel;
        articleTitle = a.title;
        break; // 一条消息只处理第一个成功抓取的链接
      }
    }

    // ---------------------------------------------------------- 3. 落笔记
    let notePath: string;

    if (body.startsWith(STANDALONE_TRIGGER)) {
      const content = body.slice(STANDALONE_TRIGGER.length).replace(/^\n+/, "");
      notePath = await writeStandaloneNote(ts, content || body);
      await appendToDaily({
        ts,
        kind,
        text: `（独立笔记）${content.split("\n")[0].slice(0, 40)}`,
        attachments,
        url: urls[0],
        articlePath,
        articleTitle,
      });
    } else {
      notePath = await appendToDaily({
        ts,
        kind: articlePath ? "article" : kind,
        text: body || undefined,
        attachments,
        url: urls[0] && !articlePath ? urls[0] : articlePath ? urls[0] : undefined,
        articlePath,
        articleTitle,
        note: articleError ? `链接抓取失败：${articleError}` : undefined,
      });
    }

    updateMessage(rowId, { note_path: notePath, status: "done" });
    notifyUploader();

    // ---------------------------------------------------------- 4. 回执
    const reply = buildReply({
      notePath,
      articleTitle,
      articlePath,
      attachmentCount: attachments.length,
      articleError,
      kind,
    });

    return { kind, notePath, articlePath, reply, ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    updateMessage(rowId, { status: "failed", error: msg });
    return { kind, reply: `❌ 处理失败：${msg}`, ok: false };
  }
}

function buildReply(o: {
  notePath: string;
  articleTitle?: string;
  articlePath?: string;
  attachmentCount: number;
  articleError?: string;
  kind: string;
}): string {
  const cfg = getConfig();
  if (!cfg.reply.enabled) return "";

  const parts: string[] = [];
  if (o.articlePath && o.articleTitle) {
    if (cfg.reply.article) parts.push(`📄 文章已存：《${o.articleTitle}》`);
  } else if (o.kind === "link" && o.articleError) {
    parts.push(`🔗 链接已记录（抓取失败：${o.articleError}）`);
  } else if (cfg.reply.text) {
    parts.push("✅ 已记录");
  }

  if (o.attachmentCount && cfg.reply.media) {
    parts.push(`📎 附件 ${o.attachmentCount} 个`);
  }

  if (!parts.length) return "";
  const dir = path.basename(path.dirname(o.notePath)) || "";
  parts.push(`→ ${o.notePath}${dir ? "" : ""}`);
  return parts.join("\n");
}
