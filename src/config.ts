import fs from "node:fs";
import path from "node:path";

export type Config = {
  /** 本地镜像目录：所有收到的内容先落这里，OneDrive 上传的是它的副本 */
  libraryDir: string;
  /** 时区，影响笔记按天分文件的日期 */
  timezone: string;
  ilink: {
    baseUrl: string;
    cdnBaseUrl: string;
    channelVersion: string;
  };
  article: {
    /** 收到链接是否自动抓成 Markdown 文章 */
    enabled: boolean;
    timeoutMs: number;
    maxBytes: number;
    /** 文章内图片是否下载到本地（微信 CDN 链接会过期，强烈建议开） */
    downloadImages: boolean;
  };
  onedrive: {
    enabled: boolean;
    /**
     * 存储模式：
     *  - appfolder：写进 OneDrive 应用目录（应用/wxcollector/），沙盒隔离，路径固定
     *  - full：写 OneDrive 任意文件夹，需 Files.ReadWrite 权限
     */
    mode: "appfolder" | "full";
    /**
     * Azure 应用 client_id。留空则用内置默认值（零配置登录）。
     * 填自己的则使用自己的配额。
     */
    clientId: string;
    tenant: string;
    /** full 模式下的目标根目录，相对 drive root */
    remoteRoot: string;
  };
  reply: {
    /** 是否给微信回执 */
    enabled: boolean;
    text: boolean;
    article: boolean;
    media: boolean;
  };
  upload: {
    /** 上传轮询间隔（秒） */
    intervalSec: number;
  };
};

export const DATA_DIR = path.resolve(process.env.WXC_DATA_DIR || "data");
export const CONFIG_PATH = path.join(DATA_DIR, "config.json");
export const DB_PATH = path.join(DATA_DIR, "wxcollector.db");

export function defaultConfig(): Config {
  return {
    libraryDir: path.join(DATA_DIR, "library"),
    timezone: "Asia/Shanghai",
    ilink: {
      baseUrl: "https://ilinkai.weixin.qq.com",
      cdnBaseUrl: "https://novac2c.cdn.weixin.qq.com/c2c",
      channelVersion: "1.0.2",
    },
    article: {
      enabled: true,
      timeoutMs: 20_000,
      maxBytes: 8 * 1024 * 1024,
      downloadImages: true,
    },
    onedrive: {
      enabled: false,
      mode: "appfolder",
      clientId: "",
      tenant: "common",
      remoteRoot: "微信收集",
    },
    reply: {
      enabled: true,
      text: true,
      article: true,
      media: true,
    },
    upload: {
      intervalSec: 30,
    },
  };
}

/** 深合并，保证旧配置缺字段时不会炸 */
function merge<T>(base: T, patch: unknown): T {
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    const cur = (base as Record<string, unknown>)[k];
    if (cur && typeof cur === "object" && !Array.isArray(cur)) {
      out[k] = merge(cur, v);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out as T;
}

let cached: Config | null = null;

export function loadConfig(): Config {
  if (cached) return cached;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  let cfg = defaultConfig();
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      cfg = merge(cfg, JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")));
    }
  } catch {
    // 配置损坏时退回默认值，不阻塞启动
  }
  cached = cfg;
  return cfg;
}

export function getConfig(): Config {
  return cached ?? loadConfig();
}

export function saveConfig(patch: unknown): Config {
  const next = merge(getConfig(), patch);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), "utf-8");
  cached = next;
  return next;
}

/** 按配置时区输出 YYYY-MM-DD */
export function dateKey(ts: number, tz = getConfig().timezone): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date(ts));
}

/** 按配置时区输出 HH:mm */
export function timeKey(ts: number, tz = getConfig().timezone): string {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return fmt.format(new Date(ts));
}
