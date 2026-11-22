/**
 * Web 管理界面 + HTTP API。
 *
 * 只依赖 node:http，不引入框架 —— 这个程序的规模用不上。
 */

import http from "node:http";

import { getConfig, saveConfig, type Config } from "./config.ts";
import { assetStats, recentArticles, recentMessages, retryFailedAssets } from "./db.ts";
import { extractUrls, fetchArticle } from "./article.ts";
import {
  clearAccount,
  fetchQRCode,
  loadAccount,
  pollQRStatus,
  saveAccount,
  type QRState,
} from "./ilink.ts";
import { libraryDir, libraryStats, rebuildIndex } from "./library.ts";
import { loopState, startLoop, stopLoop } from "./loop.ts";
import {
  clearDeviceCode,
  deviceCodeFromCache,
  disconnect as odDisconnect,
  hasRefreshToken,
  pollDeviceToken,
  startDeviceCode,
  verifyAccount,
  usingBuiltinClient,
  describeRemoteTarget,
  BUILTIN_CLIENT_ID,
} from "./onedrive.ts";
import { pendingUploadCount, recentUploads, retryFailedUploads, startUploader, syncOnce, uploaderStatus } from "./uploader.ts";
import {
  getAutostartStatus,
  installAutostart,
  previewUnit,
  uninstallAutostart,
} from "./autostart.ts";
import { renderUI } from "./ui.ts";

const PORT = Number(process.env.WXC_PORT || 8787);
const HOST = process.env.WXC_HOST || "127.0.0.1";

// --------------------------------------------------------------- 登录会话状态

type LoginSession = {
  qr: QRState;
  qrDataUrl: string;
  createdAt: number;
  status: "wait" | "scaned" | "expired" | "confirmed";
  error?: string;
};

let loginSession: LoginSession | null = null;
let loginTimer: NodeJS.Timeout | null = null;

async function qrToDataUrl(url: string): Promise<string> {
  const QR = (await import("qrcode")).default;
  return QR.toDataURL(url, { width: 320, margin: 1, errorCorrectionLevel: "M" });
}

function stopLoginPolling(): void {
  if (loginTimer) {
    clearTimeout(loginTimer);
    loginTimer = null;
  }
}

function startLoginPolling(): void {
  stopLoginPolling();
  const tick = async (): Promise<void> => {
    if (!loginSession) return;
    try {
      const st = await pollQRStatus(loginSession.qr.qrcode);
      if (st.status === "confirmed") {
        saveAccount(st.account);
        loginSession.status = "confirmed";
        stopLoginPolling();
        startLoop(st.account);
        return;
      }
      if (st.status === "expired") {
        // 自动换一张
        const qr = await fetchQRCode();
        loginSession = {
          qr,
          qrDataUrl: await qrToDataUrl(qr.url),
          createdAt: Date.now(),
          status: "wait",
        };
      } else {
        loginSession.status = st.status;
      }
    } catch (err) {
      if (loginSession) loginSession.error = err instanceof Error ? err.message : String(err);
    }
    loginTimer = setTimeout(() => void tick(), 1200);
  };
  loginTimer = setTimeout(() => void tick(), 800);
}

// --------------------------------------------------------------- OneDrive 授权轮询

type OdLoginState = {
  status: "idle" | "pending" | "slow_down" | "ok" | "expired" | "error";
  account?: { displayName: string; mail?: string } | null;
  error?: string;
};

let odLoginState: OdLoginState = { status: "idle" };
let odPollTimer: NodeJS.Timeout | null = null;

function stopDevicePolling(): void {
  if (odPollTimer) {
    clearTimeout(odPollTimer);
    odPollTimer = null;
  }
}

/** 后台自动轮询设备码，用户只需在浏览器完成授权，无需再点「检查状态」 */
function startDevicePolling(): void {
  stopDevicePolling();
  const tick = async (): Promise<void> => {
    try {
      const r = await pollDeviceToken();
      if (r.state === "ok") {
        const me = await verifyAccount().catch(() => null);
        odLoginState = { status: "ok", account: me };
        startUploader();
        stopDevicePolling();
        return;
      }
      if (r.state === "expired") {
        odLoginState = { status: "expired" };
        stopDevicePolling();
        return;
      }
      odLoginState = { status: r.state };
    } catch (err) {
      odLoginState = { status: "error", error: err instanceof Error ? err.message : String(err) };
      stopDevicePolling();
      return;
    }
    odPollTimer = setTimeout(() => void tick(), 4000);
  };
  odPollTimer = setTimeout(() => void tick(), 3000);
}

// --------------------------------------------------------------- 工具

function json(res: http.ServerResponse, code: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 2 * 1024 * 1024) throw new Error("请求体过大");
    chunks.push(c as Buffer);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
}

// --------------------------------------------------------------- 路由

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const p = url.pathname;
  const method = req.method || "GET";

  // ---- 首页
  if (p === "/" && method === "GET") {
    const html = renderUI();
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }

  // ---- 状态总览
  if (p === "/api/status" && method === "GET") {
    const account = loadAccount();
    const cfg = getConfig();
    const lib = await libraryStats().catch(() => ({ files: 0, bytes: 0 }));
    json(res, 200, {
      wechat: {
        bound: !!account,
        botId: account?.botId ?? null,
        userId: account?.userId ?? null,
        savedAt: account?.savedAt ?? null,
        ...loopState,
      },
      onedrive: uploaderStatus(),
      library: { dir: libraryDir(), ...lib },
      assets: assetStats(),
      pendingUploads: pendingUploadCount(),
      config: {
        articleEnabled: cfg.article.enabled,
        replyEnabled: cfg.reply.enabled,
        remoteRoot: cfg.onedrive.remoteRoot,
        onedriveMode: cfg.onedrive.mode,
        usingBuiltinClient: usingBuiltinClient(),
      },
    });
    return;
  }

  // ---- 配置
  if (p === "/api/config" && method === "GET") {
    json(res, 200, getConfig());
    return;
  }
  if (p === "/api/config" && method === "PUT") {
    const body = (await readBody(req)) as Partial<Config>;
    const next = saveConfig(body);
    // 配置改了重启上传器以应用新间隔/开关
    startUploader();
    json(res, 200, next);
    return;
  }

  // ---- 微信扫码登录
  if (p === "/api/login/start" && method === "POST") {
    try {
      const qr = await fetchQRCode();
      loginSession = {
        qr,
        qrDataUrl: await qrToDataUrl(qr.url),
        createdAt: Date.now(),
        status: "wait",
      };
      startLoginPolling();
      json(res, 200, { ok: true, qrDataUrl: loginSession.qrDataUrl, url: qr.url });
    } catch (err) {
      json(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (p === "/api/login/poll" && method === "GET") {
    if (!loginSession) {
      json(res, 200, { status: "idle" });
      return;
    }
    json(res, 200, {
      status: loginSession.status,
      qrDataUrl: loginSession.qrDataUrl,
      error: loginSession.error,
      botId: loginSession.status === "confirmed" ? loadAccount()?.botId : undefined,
    });
    return;
  }
  if (p === "/api/login/cancel" && method === "POST") {
    stopLoginPolling();
    loginSession = null;
    json(res, 200, { ok: true });
    return;
  }
  if (p === "/api/logout" && method === "POST") {
    stopLoop();
    stopLoginPolling();
    loginSession = null;
    clearAccount();
    json(res, 200, { ok: true });
    return;
  }

  // ---- 消息 / 文章 / 上传记录
  if (p === "/api/messages" && method === "GET") {
    json(res, 200, recentMessages(Number(url.searchParams.get("limit") || 100)));
    return;
  }
  if (p === "/api/articles" && method === "GET") {
    json(res, 200, recentArticles(Number(url.searchParams.get("limit") || 50)));
    return;
  }
  if (p === "/api/uploads" && method === "GET") {
    json(res, 200, recentUploads(Number(url.searchParams.get("limit") || 50)));
    return;
  }

  // ---- 手动操作
  if (p === "/api/sync" && method === "POST") {
    const r = await syncOnce(true);
    json(res, 200, r);
    return;
  }
  if (p === "/api/retry-uploads" && method === "POST") {
    const n = retryFailedUploads();
    const a = retryFailedAssets();
    void syncOnce();
    json(res, 200, { ok: true, reset: n, assets: a });
    return;
  }
  if (p === "/api/rebuild-index" && method === "POST") {
    await rebuildIndex();
    json(res, 200, { ok: true });
    return;
  }

  // ---- 文章抓取测试（不落库）
  if (p === "/api/test/article" && method === "POST") {
    const body = (await readBody(req)) as { url?: string };
    let target = body.url?.trim();
    if (!target) {
      json(res, 400, { ok: false, error: "缺少 url" });
      return;
    }
    // 允许直接粘贴一整段带链接的文字
    if (!/^https?:\/\//i.test(target)) {
      const found = extractUrls(target);
      if (!found.length) {
        json(res, 400, { ok: false, error: "没有识别到链接" });
        return;
      }
      target = found[0];
    }
    const r = await fetchArticle(target);
    if (!r.ok) {
      json(res, 200, { ok: false, reason: r.reason });
      return;
    }
    json(res, 200, {
      ok: true,
      title: r.article.title,
      author: r.article.author,
      isWechat: r.article.isWechat,
      images: r.article.imageUrls.length,
      chars: r.article.markdown.length,
      preview: r.article.markdown.slice(0, 3000),
    });
    return;
  }

  // ---- OneDrive 设备码授权
  if (p === "/api/onedrive/device" && method === "POST") {
    try {
      const dc = await startDeviceCode();
      odLoginState = { status: "pending" };
      startDevicePolling();
      json(res, 200, { ok: true, ...dc });
    } catch (err) {
      json(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (p === "/api/onedrive/poll" && method === "POST") {
    try {
      const r = await pollDeviceToken();
      if (r.state === "ok") {
        const me = await verifyAccount().catch(() => null);
        odLoginState = { status: "ok", account: me };
        startUploader();
        json(res, 200, { state: "ok", account: me });
      } else {
        if (r.state === "expired") odLoginState = { status: "expired" };
        else if (odLoginState.status !== "ok") odLoginState = { status: r.state };
        json(res, 200, { state: r.state });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      odLoginState = { status: "error", error: msg };
      json(res, 500, { state: "error", error: msg });
    }
    return;
  }
  // 轻量轮询端点：前端每秒查一次，服务端后台自动换取令牌
  if (p === "/api/onedrive/watch" && method === "GET") {
    json(res, 200, { ...odLoginState, loggedIn: hasRefreshToken() });
    return;
  }
  if (p === "/api/onedrive/status" && method === "GET") {
    const dc = deviceCodeFromCache();
    let account: { displayName: string; mail?: string } | null = null;
    if (hasRefreshToken()) {
      account = await verifyAccount().catch(() => null);
    }
    const cfg = getConfig();
    json(res, 200, {
      loggedIn: hasRefreshToken(),
      account,
      deviceCode: dc ? { userCode: dc.user_code, uri: dc.verification_uri, message: dc.message } : null,
      uploader: uploaderStatus(),
      mode: cfg.onedrive.mode,
      remoteTarget: describeRemoteTarget(),
      usingBuiltinClient: usingBuiltinClient(),
      builtinClientId: BUILTIN_CLIENT_ID,
    });
    return;
  }
  if (p === "/api/onedrive/logout" && method === "POST") {
    odDisconnect();
    clearDeviceCode();
    stopDevicePolling();
    odLoginState = { status: "idle" };
    json(res, 200, { ok: true });
    return;
  }

  // ---- 开机自启动
  if (p === "/api/autostart" && method === "GET") {
    json(res, 200, await getAutostartStatus());
    return;
  }
  if (p === "/api/autostart/install" && method === "POST") {
    try {
      json(res, 200, { ok: true, status: await installAutostart() });
    } catch (err) {
      json(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (p === "/api/autostart/uninstall" && method === "POST") {
    try {
      json(res, 200, { ok: true, status: await uninstallAutostart() });
    } catch (err) {
      json(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (p === "/api/autostart/preview" && method === "GET") {
    json(res, 200, previewUnit());
    return;
  }

  json(res, 404, { error: "not found" });
}

// --------------------------------------------------------------- 启动

export function startServer(): void {
  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error("[http]", err);
      try {
        json(res, 500, { error: err instanceof Error ? err.message : String(err) });
      } catch {
        /* ignore */
      }
    });
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`\n  ✗ 端口 ${PORT} 已被占用。`);
      console.error(`    可能是另一个 wxcollector 正在运行。`);
      console.error(`    换个端口：WXC_PORT=8788 npm start\n`);
      process.exit(1);
    }
    if (err.code === "EACCES") {
      console.error(`\n  ✗ 没有权限监听 ${HOST}:${PORT}。1024 以下端口需要 root。\n`);
      process.exit(1);
    }
    throw err;
  });

  server.listen(PORT, HOST, () => {
    console.log(`\n  wxcollector 管理界面:  http://${HOST}:${PORT}\n`);
  });
}

