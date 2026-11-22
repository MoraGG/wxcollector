/**
 * 入口：加载配置 → 建目录 → 恢复登录 → 启动主循环 + 上传器 + Web 界面。
 */

import fs from "node:fs/promises";
import path from "node:path";

import { DATA_DIR, getConfig, loadConfig } from "./config.ts";
import { ensureLibrary } from "./library.ts";
import { loadAccount, type Account } from "./ilink.ts";
import { startLoop, loopState } from "./loop.ts";
import { startServer } from "./server.ts";
import { startUploader } from "./uploader.ts";
import { hasRefreshToken } from "./onedrive.ts";

async function main(): Promise<void> {
  const cfg = loadConfig();

  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(cfg.libraryDir, { recursive: true });
  await ensureLibrary();

  console.log("─".repeat(52));
  console.log("  wxcollector · 微信 → 本地镜像 → OneDrive");
  console.log("─".repeat(52));
  console.log(`  数据目录  ${DATA_DIR}`);
  console.log(`  镜像目录  ${cfg.libraryDir}`);
  console.log(`  时区      ${cfg.timezone}`);
  console.log(`  文章抓取  ${cfg.article.enabled ? "开" : "关"}`);
  console.log(`  OneDrive  ${cfg.onedrive.enabled ? "开" : "关"}${hasRefreshToken() ? "（已登录）" : ""}`);
  console.log("─".repeat(52));

  // 恢复微信登录
  const account: Account | null = loadAccount();
  if (account) {
    console.log(`  微信      已绑定 ${account.botId}，启动长轮询`);
    startLoop(account);
  } else {
    console.log("  微信      未绑定，请打开管理界面扫码");
  }

  // 启动上传器
  if (cfg.onedrive.enabled && hasRefreshToken()) {
    startUploader();
    console.log("  OneDrive  上传器已启动");
  } else if (cfg.onedrive.enabled) {
    console.log("  OneDrive  已启用但未登录，请先在界面授权");
  }

  startServer();

  // 优雅退出
  const shutdown = async (): Promise<void> => {
    console.log("\n正在退出…");
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((err) => {
  console.error("启动失败:", err);
  process.exit(1);
});
