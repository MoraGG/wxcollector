/**
 * iLink（智联）协议客户端 —— 微信 ClawBot 的官方 Bot 通道。
 *
 * 协议只有 5 个端点：
 *   GET  /ilink/bot/get_bot_qrcode     拿二维码
 *   GET  /ilink/bot/get_qrcode_status  轮询扫码状态 → bot_token
 *   POST /ilink/bot/getupdates         长轮询收消息（~35s hold）
 *   POST /ilink/bot/sendmessage        回消息（必须带 context_token）
 *   POST /ilink/bot/getconfig          拿 typing_ticket
 *
 * 鉴权：Authorization: Bearer <bot_token>，外加 AuthorizationType 和随机 X-WECHAT-UIN。
 */

import crypto from "node:crypto";

import { getConfig } from "./config.ts";
import { kvGet, kvSet, kvDel } from "./db.ts";

// ---------------------------------------------------------------- 常量

export const MessageType = { NONE: 0, USER: 1, BOT: 2 } as const;
export const MessageItemType = { NONE: 0, TEXT: 1, IMAGE: 2, VOICE: 3, FILE: 4, VIDEO: 5 } as const;
export const MessageState = { NEW: 0, GENERATING: 1, FINISH: 2 } as const;
export const TypingStatus = { TYPING: 1, CANCEL: 2 } as const;

/** 会话过期，需要重新扫码 */
export const ERRCODE_SESSION_EXPIRED = -14;
/** 发送被限流 / 超出额度 */
export const ERRCODE_THROTTLED = -2;

// ---------------------------------------------------------------- 类型

export type CDNMedia = {
  encrypt_query_param?: string;
  aes_key?: string;
  encrypt_type?: number;
};

export type MessageItem = {
  type?: number;
  create_time_ms?: number;
  msg_id?: string;
  ref_msg?: { message_item?: MessageItem; title?: string };
  text_item?: { text?: string };
  image_item?: { media?: CDNMedia; thumb_media?: CDNMedia; aeskey?: string; url?: string };
  voice_item?: { media?: CDNMedia; encode_type?: number; sample_rate?: number; playtime?: number; text?: string };
  file_item?: { media?: CDNMedia; file_name?: string; md5?: string; len?: string };
  video_item?: { media?: CDNMedia; video_size?: number; play_length?: number; thumb_media?: CDNMedia };
};

export type WeixinMessage = {
  seq?: number;
  message_id?: number;
  from_user_id?: string;
  to_user_id?: string;
  client_id?: string;
  create_time_ms?: number;
  session_id?: string;
  message_type?: number;
  message_state?: number;
  item_list?: MessageItem[];
  context_token?: string;
};

export type GetUpdatesResp = {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  msgs?: WeixinMessage[];
  get_updates_buf?: string;
  longpolling_timeout_ms?: number;
};

export type Account = {
  token: string;
  botId: string;
  baseUrl: string;
  userId?: string;
  savedAt: string;
};

// ---------------------------------------------------------------- 凭据存取

const KV_ACCOUNT = "ilink.account";
const KV_SYNCBUF = "ilink.syncbuf";

export function loadAccount(): Account | null {
  const raw = kvGet(KV_ACCOUNT);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Account;
  } catch {
    return null;
  }
}

export function saveAccount(a: Account): void {
  kvSet(KV_ACCOUNT, JSON.stringify(a));
}

export function clearAccount(): void {
  kvDel(KV_ACCOUNT);
  kvDel(KV_SYNCBUF);
}

export function loadSyncBuf(): string {
  return kvGet(KV_SYNCBUF) ?? "";
}

export function saveSyncBuf(buf: string): void {
  if (buf) kvSet(KV_SYNCBUF, buf);
}

// ---------------------------------------------------------------- 请求底层

function baseInfo() {
  return { channel_version: getConfig().ilink.channelVersion };
}

function randomUin(): string {
  const n = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(n), "utf-8").toString("base64");
}

function headers(token: string, bodyLen: number): Record<string, string> {
  return {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    Authorization: `Bearer ${token}`,
    "Content-Length": String(bodyLen),
    "X-WECHAT-UIN": randomUin(),
  };
}

async function post(endpoint: string, token: string, body: unknown, timeoutMs: number, label: string): Promise<string> {
  const cfg = getConfig();
  const base = cfg.ilink.baseUrl.endsWith("/") ? cfg.ilink.baseUrl : `${cfg.ilink.baseUrl}/`;
  const payload = JSON.stringify(body);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(new URL(endpoint, base), {
      method: "POST",
      headers: headers(token, Buffer.byteLength(payload, "utf-8")),
      body: payload,
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${label} HTTP ${res.status}: ${text.slice(0, 300)}`);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------- 扫码登录

export type QRState = { qrcode: string; url: string };

export async function fetchQRCode(): Promise<QRState> {
  const cfg = getConfig();
  const base = cfg.ilink.baseUrl.endsWith("/") ? cfg.ilink.baseUrl : `${cfg.ilink.baseUrl}/`;
  const res = await fetch(`${base}ilink/bot/get_bot_qrcode?bot_type=3`);
  if (!res.ok) throw new Error(`获取二维码失败 HTTP ${res.status}`);
  const j = (await res.json()) as { qrcode?: string; qrcode_img_content?: string; ret?: number };
  if (!j.qrcode || !j.qrcode_img_content) throw new Error("二维码响应缺字段");
  return { qrcode: j.qrcode, url: j.qrcode_img_content };
}

export type QRStatus =
  | { status: "wait" | "scaned" | "expired" }
  | { status: "confirmed"; account: Account };

export async function pollQRStatus(qrcode: string): Promise<QRStatus> {
  const cfg = getConfig();
  const base = cfg.ilink.baseUrl.endsWith("/") ? cfg.ilink.baseUrl : `${cfg.ilink.baseUrl}/`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 35_000);
  try {
    const res = await fetch(`${base}ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`, {
      headers: { "iLink-App-ClientVersion": "1" },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`轮询扫码状态失败 HTTP ${res.status}`);
    const j = (await res.json()) as {
      status?: string;
      bot_token?: string;
      ilink_bot_id?: string;
      baseurl?: string;
      ilink_user_id?: string;
    };
    if (j.status === "confirmed") {
      if (!j.bot_token || !j.ilink_bot_id) throw new Error("确认登录但缺少 token/bot_id");
      return {
        status: "confirmed",
        account: {
          token: j.bot_token,
          botId: j.ilink_bot_id,
          baseUrl: j.baseurl || cfg.ilink.baseUrl,
          userId: j.ilink_user_id,
          savedAt: new Date().toISOString(),
        },
      };
    }
    if (j.status === "expired") return { status: "expired" };
    if (j.status === "scaned") return { status: "scaned" };
    return { status: "wait" };
  } catch (err) {
    // 超时属于正常的空轮询
    if (err instanceof Error && err.name === "AbortError") return { status: "wait" };
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------- 收消息

export async function getUpdates(token: string, buf: string, timeoutMs = 35_000): Promise<GetUpdatesResp> {
  try {
    const raw = await post(
      "ilink/bot/getupdates",
      token,
      { get_updates_buf: buf, base_info: baseInfo() },
      timeoutMs,
      "getUpdates",
    );
    return JSON.parse(raw) as GetUpdatesResp;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ret: 0, msgs: [], get_updates_buf: buf };
    }
    throw err;
  }
}

// ---------------------------------------------------------------- 发消息

export async function sendText(params: {
  token: string;
  to: string;
  text: string;
  contextToken: string;
}): Promise<void> {
  await post(
    "ilink/bot/sendmessage",
    params.token,
    {
      msg: {
        from_user_id: "",
        to_user_id: params.to,
        client_id: `wxcollector:${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
        message_type: MessageType.BOT,
        message_state: MessageState.FINISH,
        item_list: [{ type: MessageItemType.TEXT, text_item: { text: params.text } }],
        context_token: params.contextToken,
      },
      base_info: baseInfo(),
    },
    15_000,
    "sendMessage",
  );
}

export async function getTypingTicket(token: string, userId: string, contextToken?: string): Promise<string | undefined> {
  try {
    const raw = await post(
      "ilink/bot/getconfig",
      token,
      { ilink_user_id: userId, context_token: contextToken, base_info: baseInfo() },
      10_000,
      "getConfig",
    );
    const j = JSON.parse(raw) as { typing_ticket?: string };
    return j.typing_ticket;
  } catch {
    return undefined;
  }
}

export async function sendTyping(token: string, userId: string, ticket: string, status: number): Promise<void> {
  try {
    await post(
      "ilink/bot/sendtyping",
      token,
      { ilink_user_id: userId, typing_ticket: ticket, status, base_info: baseInfo() },
      10_000,
      "sendTyping",
    );
  } catch {
    // 打字状态失败不影响主流程
  }
}

// ---------------------------------------------------------------- 文本抽取

function isMediaItem(i: MessageItem): boolean {
  return (
    i.type === MessageItemType.IMAGE ||
    i.type === MessageItemType.VIDEO ||
    i.type === MessageItemType.FILE ||
    i.type === MessageItemType.VOICE
  );
}

/** 抽取消息正文；引用消息会拼成 "[引用: xxx] 正文" */
export function extractText(itemList?: MessageItem[]): string {
  if (!itemList?.length) return "";
  for (const item of itemList) {
    if (item.type === MessageItemType.TEXT && item.text_item?.text != null) {
      const text = String(item.text_item.text);
      const ref = item.ref_msg;
      if (!ref) return text;
      if (ref.message_item && isMediaItem(ref.message_item)) return text;
      const parts: string[] = [];
      if (ref.title) parts.push(ref.title);
      if (ref.message_item) {
        const body = extractText([ref.message_item]);
        if (body) parts.push(body);
      }
      return parts.length ? `[引用: ${parts.join(" | ")}]\n${text}` : text;
    }
    // 语音优先用微信自带 STT 转写
    if (item.type === MessageItemType.VOICE && item.voice_item?.text) {
      return item.voice_item.text;
    }
  }
  return "";
}
