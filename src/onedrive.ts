/**
 * OneDrive 上传（Microsoft Graph）。
 *
 * 用 OAuth 设备码流程，不需要内网穿透、不需要重定向 URI，最适合跑在 NAS / 无头服务器上。
 * 需要用户在 Azure 门户自建一个应用并开启「允许公共客户端流」。
 *
 * scope 说明：
 *   Files.ReadWrite  → 可写 OneDrive 任意目录（用户要求"指定文件夹"必须用这个）
 *   若要更保守，可换成 Files.ReadWrite.AppFolder，但那样只能写「应用/」目录下。
 */

import fs from "node:fs/promises";
import path from "node:path";

import { getConfig } from "./config.ts";
import { kvGet, kvSet, kvDel } from "./db.ts";

const KV_REFRESH = "graph.refresh_token";
const KV_DEVICE = "graph.device_code";

/**
 * 内置默认应用（沿用 EasySync 的公开 client_id）。
 * 这样用户打开就能点一下登录，无需去 Azure 注册应用。
 * 想用自己的配额就在设置里填自己的 client_id。
 */
export const BUILTIN_CLIENT_ID = "7d9ac248-9c51-422f-8cba-49e0a6a1ed67";

/**
 * 需要的权限。
 *
 * 2026-11-21 修正：以前按存储模式返回不同 scope（appfolder → Files.ReadWrite.AppFolder，
 * full → Files.ReadWrite），一旦切换模式，刷新令牌时请求的 scope 集合与当初授权的不一致，
 * 微软就返回 AADSTS70000「scopes unauthorized or expired」，表现为"莫名其妙要重新登录"。
 *
 * 现在统一请求 Files.ReadWrite（它是 AppFolder 的超集，appfolder 模式写 /special/approot 一样够用），
 * 两种模式共用同一套 scope —— 授权一次即可长期有效，切换模式也不用重新登录。
 */
function scopesFor(_mode: "appfolder" | "full"): string {
  return "offline_access Files.ReadWrite Files.Read User.Read";
}

function scopes(): string {
  return scopesFor(getConfig().onedrive.mode);
}

/** 是否在使用内置应用 */
export function usingBuiltinClient(): boolean {
  return !getConfig().onedrive.clientId.trim();
}

export type DeviceCodeInfo = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
  message: string;
};

function authority(): string {
  return `https://login.microsoftonline.com/${getConfig().onedrive.tenant || "common"}`;
}

function clientId(): string {
  return getConfig().onedrive.clientId.trim() || BUILTIN_CLIENT_ID;
}

// ------------------------------------------------------------ 设备码流程

export async function startDeviceCode(): Promise<DeviceCodeInfo> {
  const body = new URLSearchParams({ client_id: clientId(), scope: scopes() });
  const res = await fetch(`${authority()}/oauth2/v2.0/devicecode`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const j = (await res.json()) as DeviceCodeInfo & { error?: string; error_description?: string };
  if (!res.ok) throw new Error(j.error_description || `设备码请求失败 HTTP ${res.status}`);
  kvSet(KV_DEVICE, JSON.stringify(j));
  return j;
}

export type TokenResult =
  | { state: "pending" | "slow_down" | "expired" }
  | { state: "ok"; accessToken: string; expiresAt: number };

export async function pollDeviceToken(): Promise<TokenResult> {
  const raw = kvGet(KV_DEVICE);
  if (!raw) throw new Error("没有进行中的设备码授权，请先发起授权");
  const dc = JSON.parse(raw) as DeviceCodeInfo;

  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    client_id: clientId(),
    device_code: dc.device_code,
  });
  const res = await fetch(`${authority()}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const j = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
  };

  if (res.ok && j.access_token) {
    if (j.refresh_token) kvSet(KV_REFRESH, j.refresh_token);
    kvDel(KV_DEVICE);
    return { state: "ok", accessToken: j.access_token, expiresAt: Date.now() + (j.expires_in ?? 3600) * 1000 };
  }

  if (j.error === "authorization_pending") return { state: "pending" };
  if (j.error === "slow_down") return { state: "slow_down" };
  if (j.error === "expired_token" || j.error === "code_expired") {
    kvDel(KV_DEVICE);
    return { state: "expired" };
  }
  throw new Error(j.error || "设备码授权失败");
}

// ------------------------------------------------------------ 令牌管理

type CachedToken = { accessToken: string; expiresAt: number };
let cachedToken: CachedToken | null = null;

export function hasRefreshToken(): boolean {
  return !!kvGet(KV_REFRESH);
}

export function disconnect(): void {
  kvDel(KV_REFRESH);
  kvDel(KV_DEVICE);
  cachedToken = null;
}

async function refreshAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.accessToken;
  }
  const rt = kvGet(KV_REFRESH);
  if (!rt) throw new Error("未登录 OneDrive");

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: clientId(),
    refresh_token: rt,
    scope: scopes(),
  });
  const res = await fetch(`${authority()}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const j = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !j.access_token) {
    throw new Error(j.error_description || "刷新令牌失败，请重新登录 OneDrive");
  }
  if (j.refresh_token) kvSet(KV_REFRESH, j.refresh_token);
  cachedToken = { accessToken: j.access_token, expiresAt: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return j.access_token;
}

export async function getAccessToken(): Promise<string> {
  return refreshAccessToken();
}

// ------------------------------------------------------------ 上传

/**
 * 把 library 内的相对路径映射到 Graph 路径。
 *
 * appfolder 模式：Files.ReadWrite.AppFolder 权限只能写「应用/<名称>/」，
 *   这个名称由 Azure 应用注册时决定，不是我们能任选的。用 /special/approot 让它自己解析。
 * full 模式：/me/drive/root:/<remoteRoot>/... 可以写任意文件夹。
 */
function encodePath(p: string): string {
  return p.split("/").filter(Boolean).map(encodeURIComponent).join("/");
}

/** 上传内容用的 Graph 地址 */
function contentUrl(relPath: string): string {
  const cfg = getConfig().onedrive;
  const clean = encodePath(relPath);

  if (cfg.mode === "appfolder") {
    // approot 是应用沙盒根目录，不需要（也不能）知道真实名字
    return `https://graph.microsoft.com/v1.0/me/drive/special/approot:/${clean}:/content`;
  }

  const root = cfg.remoteRoot.replace(/^\/+|\/+$/g, "");
  const full = root ? `${encodePath(root)}/${clean}` : clean;
  return `https://graph.microsoft.com/v1.0/me/drive/root:/${full}:/content`;
}

/** 分片上传会话用的地址 */
function uploadSessionUrl(relPath: string): string {
  const cfg = getConfig().onedrive;
  const clean = encodePath(relPath);

  if (cfg.mode === "appfolder") {
    return `https://graph.microsoft.com/v1.0/me/drive/special/approot:/${clean}:/createUploadSession`;
  }

  const root = cfg.remoteRoot.replace(/^\/+|\/+$/g, "");
  const full = root ? `${encodePath(root)}/${clean}` : clean;
  return `https://graph.microsoft.com/v1.0/me/drive/root:/${full}:/createUploadSession`;
}

/** 供界面展示：内容最终会落到哪里 */
export function describeRemoteTarget(): string {
  const cfg = getConfig().onedrive;
  if (cfg.mode === "appfolder") {
    return "OneDrive/应用/wxcollector/（沙盒目录，名称由应用注册决定）";
  }
  return `OneDrive/${cfg.remoteRoot || "（根目录）"}/`;
}

const SIMPLE_UPLOAD_LIMIT = 4 * 1024 * 1024; // 4MB，超过必须用分片会话

async function simpleUpload(relPath: string, buf: Buffer, token: string): Promise<void> {
  const res = await fetch(contentUrl(relPath), {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/octet-stream",
    },
    body: new Uint8Array(buf),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`上传失败 HTTP ${res.status}: ${t.slice(0, 200)}`);
  }
}

async function chunkedUpload(relPath: string, buf: Buffer, token: string): Promise<void> {
  // 1. 创建上传会话
  const createRes = await fetch(uploadSessionUrl(relPath), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "replace" } }),
  });
  if (!createRes.ok) {
    throw new Error(`创建上传会话失败 HTTP ${createRes.status}: ${(await createRes.text()).slice(0, 200)}`);
  }
  const { uploadUrl } = (await createRes.json()) as { uploadUrl: string };

  // 2. 分片上传，必须 320KB 的整数倍
  const CHUNK = 320 * 1024 * 10; // 3.2MB
  let offset = 0;
  while (offset < buf.length) {
    const end = Math.min(offset + CHUNK, buf.length);
    const chunk = buf.subarray(offset, end);
    const res = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Length": String(chunk.length),
        "Content-Range": `bytes ${offset}-${end - 1}/${buf.length}`,
      },
      body: new Uint8Array(chunk),
    });
    if (!res.ok && res.status !== 202) {
      throw new Error(`分片上传失败 HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    offset = end;
  }
}

/** 上传一个本地文件到 OneDrive 指定相对路径 */
export async function uploadFile(localAbs: string, relPath: string): Promise<void> {
  const token = await getAccessToken();
  const buf = await fs.readFile(localAbs);
  if (buf.length <= SIMPLE_UPLOAD_LIMIT) {
    await simpleUpload(relPath, buf, token);
  } else {
    await chunkedUpload(relPath, buf, token);
  }
}

/** 只上传文本内容（笔记），避免读整库 */
export async function uploadText(relPath: string, content: string): Promise<void> {
  const token = await getAccessToken();
  const buf = Buffer.from(content, "utf-8");
  await simpleUpload(relPath, buf, token);
}

/** 探测账号是否可用，返回显示名 */
export async function verifyAccount(): Promise<{ displayName: string; mail?: string }> {
  const token = await getAccessToken();
  const res = await fetch("https://graph.microsoft.com/v1.0/me", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`校验失败 HTTP ${res.status}`);
  const j = (await res.json()) as { displayName?: string; mail?: string; userPrincipalName?: string };
  return { displayName: j.displayName || j.userPrincipalName || "未知账号", mail: j.mail };
}

export function deviceCodeFromCache(): DeviceCodeInfo | null {
  const raw = kvGet(KV_DEVICE);
  return raw ? (JSON.parse(raw) as DeviceCodeInfo) : null;
}

export function clearDeviceCode(): void {
  kvDel(KV_DEVICE);
}

export { path };
