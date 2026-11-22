/**
 * 开机自启动管理。
 *
 * Linux  → systemd user service（配 linger，未登录也能起）
 * macOS  → LaunchAgent plist
 * 其它   → 返回不支持，附手动方案
 *
 * 注意：所有命令都用 spawn 直接执行，不经过 shell，避免路径里的空格/特殊字符出问题。
 */

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export type Platform = "linux" | "darwin" | "win32" | "other";

export type AutostartStatus = {
  platform: Platform;
  supported: boolean;
  /** 服务是否已安装（文件存在） */
  installed: boolean;
  /** 服务是否正在运行 */
  active: boolean;
  /** 是否已启用开机自启 */
  enabled: boolean;
  /** linger 是否开启（Linux，决定未登录时能否启动） */
  linger?: boolean;
  /** 单元文件 / plist 路径 */
  unitPath?: string;
  /** 当前运行方式，如 systemd / launchd / manual */
  manager?: string;
  /** 说明或错误 */
  message?: string;
};

export const SERVICE_NAME = "wxcollector";

/** 项目根目录（src 的上一级） */
function projectRoot(): string {
  const here = path.dirname(new URL(import.meta.url).pathname);
  return path.resolve(here, "..");
}

function entryPoint(): string {
  return path.join(projectRoot(), "src", "main.ts");
}

/** 当前 node 可执行文件，保证 systemd 用的是同一个版本 */
function nodeBin(): string {
  return process.execPath;
}

function detectPlatform(): Platform {
  if (process.platform === "linux") return "linux";
  if (process.platform === "darwin") return "darwin";
  if (process.platform === "win32") return "win32";
  return "other";
}

/** systemctl 需要的环境变量（非登录 shell 下常常缺失） */
function systemctlEnv(): NodeJS.ProcessEnv {
  const uid = typeof process.getuid === "function" ? process.getuid() : 1000;
  return {
    ...process.env,
    XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR || `/run/user/${uid}`,
    DBUS_SESSION_BUS_ADDRESS:
      process.env.DBUS_SESSION_BUS_ADDRESS || `unix:path=/run/user/${uid}/bus`,
  };
}

async function systemctl(args: string[]): Promise<{ ok: boolean; out: string }> {
  try {
    const { stdout, stderr } = await run("systemctl", ["--user", ...args], {
      env: systemctlEnv(),
      timeout: 15_000,
    });
    return { ok: true, out: `${stdout}${stderr}`.trim() };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, out: (e.stderr || e.stdout || e.message || "").trim() };
  }
}

// ---------------------------------------------------------------- Linux

function systemdUnitPath(): string {
  return path.join(os.homedir(), ".config", "systemd", "user", `${SERVICE_NAME}.service`);
}

function systemdUnitContent(): string {
  const root = projectRoot();
  const port = process.env.WXC_PORT || "8787";
  const host = process.env.WXC_HOST || "0.0.0.0";
  return `[Unit]
Description=wxcollector - 微信 ClawBot 收集器
Documentation=file://${root}/README.md
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${root}
ExecStart=${nodeBin()} ${entryPoint()}
Environment=NODE_ENV=production
Environment=WXC_PORT=${port}
Environment=WXC_HOST=${host}
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=wxcollector

[Install]
WantedBy=default.target
`;
}

async function linuxStatus(): Promise<AutostartStatus> {
  const unit = systemdUnitPath();
  const exists = await fs
    .access(unit)
    .then(() => true)
    .catch(() => false);

  if (!exists) {
    // 未安装，但仍报告 linger 状态，方便用户判断
    const linger = await checkLinger();
    return {
      platform: "linux",
      supported: true,
      installed: false,
      active: false,
      enabled: false,
      linger,
      unitPath: unit,
      manager: "systemd",
      message: linger
        ? "未安装开机自启"
        : "未安装。注意：linger 未开启，开机后需要登录一次才会启动",
    };
  }

  const active = await systemctl(["is-active", SERVICE_NAME]);
  const enabled = await systemctl(["is-enabled", SERVICE_NAME]);
  const linger = await checkLinger();

  return {
    platform: "linux",
    supported: true,
    installed: true,
    active: active.out === "active",
    enabled: enabled.out === "enabled",
    linger,
    unitPath: unit,
    manager: "systemd",
    message: linger
      ? undefined
      : "linger 未开启：开机后需要登录一次才会启动，建议执行 sudo loginctl enable-linger $USER",
  };
}

async function checkLinger(): Promise<boolean> {
  try {
    const user = os.userInfo().username;
    const { stdout } = await run("loginctl", ["show-user", user], { timeout: 8000 });
    return /Linger=yes/i.test(stdout);
  } catch {
    return false;
  }
}

async function linuxInstall(): Promise<AutostartStatus> {
  const unit = systemdUnitPath();
  await fs.mkdir(path.dirname(unit), { recursive: true });
  await fs.writeFile(unit, systemdUnitContent(), "utf-8");

  await systemctl(["daemon-reload"]);
  const enable = await systemctl(["enable", "--now", SERVICE_NAME]);
  const st = await linuxStatus();
  if (!enable.ok && !st.active) {
    st.message = `安装完成但启动失败：${enable.out}`;
  }
  return st;
}

async function linuxUninstall(): Promise<AutostartStatus> {
  await systemctl(["disable", "--now", SERVICE_NAME]);
  const unit = systemdUnitPath();
  await fs.unlink(unit).catch(() => {});
  await systemctl(["daemon-reload"]);
  return linuxStatus();
}

// ---------------------------------------------------------------- macOS

function launchAgentPath(): string {
  return path.join(os.homedir(), "Library", "LaunchAgents", `com.${SERVICE_NAME}.plist`);
}

function plistContent(): string {
  const root = projectRoot();
  const port = process.env.WXC_PORT || "8787";
  const host = process.env.WXC_HOST || "0.0.0.0";
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.${SERVICE_NAME}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodeBin()}</string>
    <string>${entryPoint()}</string>
  </array>
  <key>WorkingDirectory</key><string>${root}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>WXC_PORT</key><string>${port}</string>
    <key>WXC_HOST</key><string>${host}</string>
    <key>NODE_ENV</key><string>production</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${root}/data/launchd.log</string>
  <key>StandardErrorPath</key><string>${root}/data/launchd.err.log</string>
</dict>
</plist>
`;
}

async function launchctl(args: string[]): Promise<{ ok: boolean; out: string }> {
  try {
    const { stdout, stderr } = await run("launchctl", args, { timeout: 15_000 });
    return { ok: true, out: `${stdout}${stderr}`.trim() };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, out: (e.stderr || e.stdout || e.message || "").trim() };
  }
}

async function darwinStatus(): Promise<AutostartStatus> {
  const plist = launchAgentPath();
  const exists = await fs
    .access(plist)
    .then(() => true)
    .catch(() => false);
  if (!exists) {
    return {
      platform: "darwin",
      supported: true,
      installed: false,
      active: false,
      enabled: false,
      unitPath: plist,
      manager: "launchd",
      message: "未安装开机自启",
    };
  }
  const list = await launchctl(["list"]);
  const active = new RegExp(`com\\.${SERVICE_NAME}`).test(list.out);
  return {
    platform: "darwin",
    supported: true,
    installed: true,
    active,
    enabled: true,
    unitPath: plist,
    manager: "launchd",
  };
}

async function darwinInstall(): Promise<AutostartStatus> {
  const plist = launchAgentPath();
  await fs.mkdir(path.dirname(plist), { recursive: true });
  await fs.mkdir(path.join(projectRoot(), "data"), { recursive: true });
  await fs.writeFile(plist, plistContent(), "utf-8");
  await launchctl(["unload", plist]);
  const r = await launchctl(["load", "-w", plist]);
  const st = await darwinStatus();
  if (!r.ok && !st.active) st.message = `加载失败：${r.out}`;
  return st;
}

async function darwinUninstall(): Promise<AutostartStatus> {
  const plist = launchAgentPath();
  await launchctl(["unload", "-w", plist]);
  await fs.unlink(plist).catch(() => {});
  return darwinStatus();
}

// ---------------------------------------------------------------- 统一入口

export async function getAutostartStatus(): Promise<AutostartStatus> {
  const p = detectPlatform();
  if (p === "linux") return linuxStatus();
  if (p === "darwin") return darwinStatus();
  return {
    platform: p,
    supported: false,
    installed: false,
    active: false,
    enabled: false,
    message:
      p === "win32"
        ? "Windows 请用「任务计划程序」创建开机任务，或在 WSL 里用 systemd"
        : "当前平台不支持自动安装，请参考 README 手动配置",
  };
}

export async function installAutostart(): Promise<AutostartStatus> {
  const p = detectPlatform();
  if (p === "linux") return linuxInstall();
  if (p === "darwin") return darwinInstall();
  return getAutostartStatus();
}

export async function uninstallAutostart(): Promise<AutostartStatus> {
  const p = detectPlatform();
  if (p === "linux") return linuxUninstall();
  if (p === "darwin") return darwinUninstall();
  return getAutostartStatus();
}

/** 生成单元文件内容供预览，不写盘 */
export function previewUnit(): { path: string; content: string } {
  const p = detectPlatform();
  if (p === "darwin") return { path: launchAgentPath(), content: plistContent() };
  if (p === "linux") return { path: systemdUnitPath(), content: systemdUnitContent() };
  return { path: "", content: "" };
}
