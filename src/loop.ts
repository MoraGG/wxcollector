/**
 * 微信消息主循环：长轮询 getupdates，把消息交给 pipeline 处理，然后回执。
 *
 * 错误处理遵循 iLink 的实测经验：
 *  - errcode -14 = 会话过期 → 需要重新扫码，不是重试能解决的
 *  - 发送 ret=-2  = 限流 → 绝不重试，每次重试都会延长惩罚
 */

import { getConfig } from "./config.ts";
import { ERRCODE_SESSION_EXPIRED, getTypingTicket, loadSyncBuf, saveSyncBuf, sendText, sendTyping, TypingStatus, getUpdates, type Account } from "./ilink.ts";
import { processMessage } from "./pipeline.ts";

export type LoopState = {
  running: boolean;
  online: boolean;
  lastMessageAt: number | null;
  lastError: string | null;
  lastPollAt: number | null;
  handled: number;
  needsRelogin: boolean;
};

export const loopState: LoopState = {
  running: false,
  online: false,
  lastMessageAt: null,
  lastError: null,
  lastPollAt: null,
  handled: 0,
  needsRelogin: false,
};

let abort: AbortController | null = null;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new Error("aborted"));
      },
      { once: true },
    );
  });
}

/**
 * 回执发送带限流保护：失败一次就放弃，不重试。
 */
async function reply(account: Account, to: string, text: string, contextToken: string | undefined): Promise<void> {
  if (!text || !contextToken) return;
  try {
    await sendText({ token: account.token, to, text, contextToken });
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    // 限流时保持沉默，不重试
    if (m.includes("-2") || m.includes("429")) {
      loopState.lastError = "发送被限流（额度已用完），已跳过回执";
    } else {
      loopState.lastError = `回执失败: ${m}`;
    }
  }
}

export function startLoop(account: Account): void {
  if (abort) return;
  abort = new AbortController();
  loopState.running = true;
  loopState.needsRelogin = false;
  void run(account, abort.signal);
}

export function stopLoop(): void {
  abort?.abort();
  abort = null;
  loopState.running = false;
  loopState.online = false;
}

async function run(account: Account, signal: AbortSignal): Promise<void> {
  let buf = loadSyncBuf();
  let failures = 0;
  let timeoutMs = 35_000;

  while (!signal.aborted) {
    try {
      const resp = await getUpdates(account.token, buf, timeoutMs);
      loopState.lastPollAt = Date.now();

      if (resp.longpolling_timeout_ms && resp.longpolling_timeout_ms > 0) {
        timeoutMs = resp.longpolling_timeout_ms;
      }

      const ret = resp.ret ?? 0;
      const errcode = resp.errcode ?? 0;

      if (ret !== 0 || errcode !== 0) {
        if (errcode === ERRCODE_SESSION_EXPIRED || ret === ERRCODE_SESSION_EXPIRED) {
          loopState.online = false;
          loopState.needsRelogin = true;
          loopState.lastError = "会话已过期（errcode -14），请在设置页重新扫码绑定";
          stopLoop();
          return;
        }
        failures++;
        loopState.lastError = `getupdates 错误 ret=${ret} errcode=${errcode} ${resp.errmsg ?? ""}`;
        if (failures >= 3) {
          failures = 0;
          await sleep(30_000, signal);
        } else {
          await sleep(2_000, signal);
        }
        continue;
      }

      failures = 0;
      loopState.online = true;
      loopState.lastError = null;

      if (resp.get_updates_buf) {
        buf = resp.get_updates_buf;
        saveSyncBuf(buf);
      }

      const msgs = resp.msgs ?? [];
      for (let i = 0; i < msgs.length; i++) {
        const msg = msgs[i];
        const from = msg.from_user_id ?? "";

        // 打字状态：让用户知道在处理
        let ticket: string | undefined;
        if (from) {
          ticket = await getTypingTicket(account.token, from, msg.context_token);
          if (ticket) void sendTyping(account.token, from, ticket, TypingStatus.TYPING);
        }

        try {
          const result = await processMessage(msg, i);
          if (result) {
            loopState.handled++;
            loopState.lastMessageAt = Date.now();
            if (getConfig().reply.enabled) {
              await reply(account, from, result.reply, msg.context_token);
            }
          }
        } catch (err) {
          loopState.lastError = err instanceof Error ? err.message : String(err);
        } finally {
          if (ticket) void sendTyping(account.token, from, ticket, TypingStatus.CANCEL);
        }
      }
    } catch (err) {
      if (signal.aborted) return;
      failures++;
      loopState.online = false;
      loopState.lastError = err instanceof Error ? err.message : String(err);
      if (failures >= 3) {
        failures = 0;
        await sleep(30_000, signal);
      } else {
        await sleep(2_000, signal);
      }
    }
  }
}
