/**
 * 网页 / 公众号文章 → Markdown。
 *
 * 微信 mp.weixin.qq.com 有几个坑，这里都处理了：
 *  1. 正文在 #js_content，用 Readability 容易被"点赞/在看/分享"等 UI 文字污染；
 *  2. 图片用 data-src 懒加载，src 常常是占位符；
 *  3. 有时返回"环境异常/验证页"，需要识别并当作失败而不是存成空文档；
 *  4. 图片 CDN 链接带时效签名，必须下载到本地。
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";

import { getConfig } from "./config.ts";

/**
 * 微信正文是 CSR 渲染，但带桌面浏览器 UA 的请求通常能拿到服务端已渲染好的 #js_content。
 * 所以按「桌面 → 移动」顺序轮换，全部失败再判定为抓不到。
 */
const UA_LIST = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.50",
];
const UA = UA_LIST[0];

export type ExtractedArticle = {
  title: string;
  author?: string;
  siteName?: string;
  publishedAt?: string;
  markdown: string;
  /** 文中图片的原始 URL，按出现顺序 */
  imageUrls: string[];
  isWechat: boolean;
};

export type FetchArticleResult =
  | { ok: true; article: ExtractedArticle }
  | { ok: false; reason: string };

/** 从一段文本里抽出所有 http(s) 链接 */
export function extractUrls(text: string): string[] {
  const re = /https?:\/\/[^\s<>"'）)】\]，。；、]+/g;
  const found = text.match(re) ?? [];
  // 去尾部常见标点
  return [...new Set(found.map((u) => u.replace(/[.,;:!?]+$/, "")))];
}

export function isWechatArticle(url: string): boolean {
  return /^https?:\/\/mp\.weixin\.qq\.com\//i.test(url);
}

/** 从页面内嵌的 script 变量里取元数据，CSR 空壳时这是唯一能拿到的东西 */
function extractScriptMeta(html: string): { title?: string; author?: string; account?: string } {
  const pick = (key: string): string | undefined => {
    const re = new RegExp(`var\\s+${key}\\s*=\\s*["']([^"']*)["']`);
    const m = re.exec(html);
    if (!m) return undefined;
    try {
      return JSON.parse(`"${m[1].replace(/"/g, '\\"')}"`).trim() || undefined;
    } catch {
      return m[1].trim() || undefined;
    }
  };
  return {
    title: pick("msg_title") ?? pick("title"),
    author: pick("msg_author"),
    account: pick("nickname"),
  };
}

/** 识别微信的各类拦截/失效页，返回具体原因 */
function detectBlockPage(html: string): string | null {
  if (html.includes("环境异常") || html.includes("完成验证后即可继续访问")) {
    return "命中微信验证页（需要人工验证）";
  }
  if (html.includes("该内容已被发布者删除")) return "文章已被发布者删除";
  if (html.includes("此内容因违规无法查看")) return "文章因违规无法查看";
  if (html.includes("链接已过期")) return "链接已过期";
  if (html.includes("参数错误") && html.length < 60_000) return "链接参数错误或已失效";
  return null;
}

async function fetchHtml(url: string, ua = UA): Promise<string> {
  const cfg = getConfig().article;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": ua,
        Referer: "https://mp.weixin.qq.com/",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
      redirect: "follow",
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > cfg.maxBytes) throw new Error(`页面过大 (${buf.length} 字节)`);
    return buf.toString("utf-8");
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 微信文章专用提取：直接取 #js_content，清掉 UI 元素，比 Readability 干净得多。
 */
function extractWechat(html: string): { title: string; author?: string; contentHtml: string } | null {
  const { document } = parseHTML(html);

  const content = document.querySelector("#js_content");
  if (!content) return null;

  // 清掉公众号的装饰性元素
  for (const sel of [
    "script",
    "style",
    ".reward_area",
    ".qr_code_pc",
    "#js_pc_qr_code",
    ".rich_media_tool",
    ".like_btn_wrp",
    ".share_notice",
    ".js_ad_area",
    ".mp_profile_iframe_wrp",
  ]) {
    content.querySelectorAll(sel).forEach((n: Element) => n.remove());
  }

  // 懒加载图片：data-src 才是真图
  content.querySelectorAll("img").forEach((img: Element) => {
    const real = img.getAttribute("data-src") || img.getAttribute("data-original") || img.getAttribute("src");
    if (real && !real.startsWith("data:")) {
      img.setAttribute("src", real);
    }
  });

  const title =
    document.querySelector("#activity-name")?.textContent?.trim() ||
    document.querySelector('meta[property="og:title"]')?.getAttribute("content")?.trim() ||
    document.title?.trim() ||
    "未命名文章";

  const author =
    document.querySelector("#js_name")?.textContent?.trim() ||
    document.querySelector('meta[name="author"]')?.getAttribute("content")?.trim() ||
    undefined;

  return { title, author, contentHtml: content.innerHTML };
}

/** 通用提取：Readability */
function extractGeneric(html: string): { title: string; author?: string; siteName?: string; contentHtml: string } | null {
  const { document } = parseHTML(html);
  const art = new Readability(document as unknown as Document, { charThreshold: 200 }).parse();
  if (!art?.content) return null;
  return {
    title: art.title?.trim() || document.title?.trim() || "未命名文章",
    author: art.byline?.trim() || undefined,
    siteName: art.siteName?.trim() || undefined,
    contentHtml: art.content,
  };
}

function buildTurndown(): TurndownService {
  const td = new TurndownService({
    headingStyle: "atx",
    hr: "---",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
  });

  // 图片：保留 src，后面统一改写成本地相对路径
  td.addRule("figure-image", {
    filter: "img",
    replacement: (_content, node) => {
      const el = node as unknown as Element;
      const src = el.getAttribute("src") || el.getAttribute("data-src") || "";
      if (!src) return "";
      const alt = (el.getAttribute("alt") || "").trim();
      return `\n\n![${alt}](${src})\n\n`;
    },
  });

  // 去掉残留的 iframe / 视频占位
  td.addRule("drop-iframe", {
    filter: ["iframe", "video", "audio"],
    replacement: () => "",
  });

  // 微信常见的 <section> 包裹，转成段落
  td.addRule("section-block", {
    filter: "section",
    replacement: (content) => (content.trim() ? `\n\n${content.trim()}\n\n` : ""),
  });

  return td;
}

/** 从 Markdown 中收集图片 URL */
function collectImages(markdown: string): string[] {
  const out: string[] = [];
  const re = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown))) {
    const u = m[1];
    if (u && !u.startsWith("data:")) out.push(u);
  }
  return out;
}

export async function fetchArticle(url: string): Promise<FetchArticleResult> {
  const wechat = isWechatArticle(url);

  // 微信文章按 UA 轮换重试；普通网页一次就够
  const attempts = wechat ? UA_LIST : [UA];
  let lastReason = "抓取失败";

  for (const ua of attempts) {
    let html: string;
    try {
      html = await fetchHtml(url, ua);
    } catch (err) {
      lastReason = `抓取失败: ${err instanceof Error ? err.message : String(err)}`;
      continue;
    }

    const blocked = detectBlockPage(html);
    if (blocked) {
      lastReason = blocked;
      continue;
    }

    let parsed = wechat ? extractWechat(html) : null;
    if (!parsed) parsed = extractGeneric(html);

    // CSR 空壳兜底：至少用 script 变量里的标题和摘要存一条记录，别丢
    if (!parsed || parsed.contentHtml.trim().length < 40) {
      const meta = extractScriptMeta(html);
      if (meta.title) {
        return {
          ok: true,
          article: {
            title: meta.title,
            author: meta.author,
            siteName: meta.account,
            markdown: `> ⚠️ 正文未能完整抓取（可能为客户端渲染或需在微信内打开），以下仅有元信息。\n\n- 标题：${meta.title}\n${meta.author ? `- 作者：${meta.author}\n` : ""}${meta.account ? `- 公众号：${meta.account}\n` : ""}`,
            imageUrls: [],
            isWechat: wechat,
          },
        };
      }
      lastReason = "无法识别正文";
      continue;
    }

    const td = buildTurndown();
    let markdown = td.turndown(parsed.contentHtml)
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]+$/gm, "")
      .trim();

    if (markdown.length < 80) {
      // 正文抽不出来（图片型文章 / CSR 空壳），退回元数据，至少不丢标题和来源
      const meta = extractScriptMeta(html);
      const title = meta.title || parsed.title;
      if (title && title !== "未命名文章") {
        return {
          ok: true,
          article: {
            title,
            author: meta.author || parsed.author,
            siteName: meta.account,
            markdown:
              `> ⚠️ 正文未能完整抓取（正文 ${markdown.length} 字，可能是图片型文章或需在微信内打开），以下仅有元信息。\n\n` +
              `- 标题：${title}\n` +
              (meta.author ? `- 作者：${meta.author}\n` : "") +
              (meta.account ? `- 公众号：${meta.account}\n` : ""),
            imageUrls: [],
            isWechat: wechat,
          },
        };
      }
      lastReason = `正文过短 (${markdown.length} 字)，可能是验证页或空壳`;
      continue;
    }

    return {
      ok: true,
      article: {
        title: parsed.title,
        author: parsed.author,
        siteName: "siteName" in parsed ? parsed.siteName : undefined,
        markdown,
        imageUrls: collectImages(markdown),
        isWechat: wechat,
      },
    };
  }

  return { ok: false, reason: lastReason };
}

// ------------------------------------------------------------------ 图片本地化

function hashName(url: string, ext: string): string {
  return crypto.createHash("sha1").update(url).digest("hex").slice(0, 16) + ext;
}

function extOf(url: string): string {
  try {
    const p = new URL(url).pathname;
    const e = path.extname(p).toLowerCase();
    if ([".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".bmp"].includes(e)) return e;
  } catch {
    /* ignore */
  }
  // 微信图片 URL 常带 wx_fmt=png 参数
  const m = /[?&]wx_fmt=(\w+)/.exec(url);
  if (m) return `.${m[1]}`;
  return ".jpg";
}

/**
 * 把 Markdown 里的图片下载到 assetsDir，并把链接改写为相对路径。
 * 返回改写后的 Markdown 和成功下载数量。
 */
export async function localizeImages(
  markdown: string,
  imageUrls: string[],
  assetsDir: string,
  assetsRelPrefix: string,
): Promise<{ markdown: string; downloaded: number; failed: number }> {
  if (!getConfig().article.downloadImages || !imageUrls.length) {
    return { markdown, downloaded: 0, failed: 0 };
  }

  await fs.mkdir(assetsDir, { recursive: true });
  let md = markdown;
  let downloaded = 0;
  let failed = 0;

  for (const url of imageUrls) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15_000);
      let buf: Buffer;
      try {
        const res = await fetch(url, {
          headers: { "User-Agent": UA, Referer: "https://mp.weixin.qq.com/" },
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        buf = Buffer.from(await res.arrayBuffer());
      } finally {
        clearTimeout(timer);
      }

      const name = hashName(url, extOf(url));
      await fs.writeFile(path.join(assetsDir, name), buf);
      // 用相对路径，保证在 Obsidian / 任意 Markdown 阅读器里都能显示
      md = md.split(`](${url})`).join(`](${assetsRelPrefix}/${name})`);
      downloaded++;
    } catch {
      failed++;
      // 下载失败保留原链接，至少不会丢
    }
  }

  return { markdown: md, downloaded, failed };
}
