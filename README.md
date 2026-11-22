# wxcollector

微信 ClawBot → 本地镜像 → OneDrive 的独立收集器，带 Web 管理界面。

**不需要 Obsidian。** 一个进程搞定：微信里发给 ClawBot 的文字、图片、语音、文件、公众号链接，自动落成 Markdown 存到本地，再自动上传到 OneDrive 你指定的任意文件夹。

```
微信 ClawBot
    ↓  iLink 官方协议（长轮询）
wxcollector
    ├→ 本地镜像  data/library/      ← 随时可看、可备份、可给任何工具读
    └→ OneDrive  你指定的文件夹      ← Microsoft Graph 直传
```

---

## 它解决什么问题

WXLink 的思路是对的（微信消息落成本地 Markdown），但它跑在 Obsidian 里：必须开着 Obsidian、只能写 vault、云端路径被 EasySync 限制在 `应用/EasySync/vaults/<仓库名>/files/` 下。

这个程序把那层壳去掉，直接用 iLink 协议 + Graph API：

| | WXLink + EasySync | wxcollector |
|---|---|---|
| 依赖 Obsidian | 必须开 | 不需要 |
| 运行位置 | 桌面端 | 任意机器 / NAS / 服务器，7×24 |
| OneDrive 路径 | 固定应用目录 | **任意文件夹**（`Files.ReadWrite`） |
| 管理界面 | Obsidian 设置页 | 独立 Web UI |
| 同步粒度 | 整库 | 只传收到的内容 |

---

## 快速开始

```bash
npm install
npm start
```

打开 `http://127.0.0.1:8787`。

环境变量：

| 变量 | 默认 | 说明 |
|---|---|---|
| `WXC_PORT` | `8787` | 端口 |
| `WXC_HOST` | `127.0.0.1` | 监听地址，要局域网访问改成 `0.0.0.0` |
| `WXC_DATA_DIR` | `./data` | 数据目录（配置、数据库、镜像） |

要求 Node ≥ 22.6（用到内置 `node:sqlite` 和原生 TypeScript 运行）。

---

## 三步用起来

> 微信绑定和 OneDrive 授权**都在 WebUI 里完成**，不需要改配置文件或敲命令。

### 1. 绑定微信

管理界面 → **微信连接** → **扫码绑定** → 手机微信扫码确认。

> ⚠️ 绑定成功后，**必须先在微信里给机器人发一条消息**。网关只在绑定账号主动发过消息后才下发 `context_token`，跳过这步回执会失败。

绑定后微信通讯录里出现一个 ClawBot 联系人，给它发消息就行。

### 2. 配置 OneDrive（可选）

管理界面 → **OneDrive**，按页面指引在 Azure 注册一个应用：

1. [Azure 门户 → 应用注册 → 新注册](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade)
2. 账户类型选「个人 Microsoft 账户」或含个人账户的任意选项
3. **「身份验证」→ 允许公共客户端流 → 是**（设备码流程必需）
4. **「API 权限」→ Microsoft Graph → 委托权限**：`Files.ReadWrite`、`User.Read`，然后授予管理员同意
5. 把「应用程序(客户端) ID」填进界面

然后点 **开始授权**，会给出一个验证码和网址。浏览器打开网址、输入验证码并同意后，**界面会自动检测到并完成登录**，不需要回来点任何按钮。

用的是 **OAuth 设备码流程**，不需要重定向 URI、不需要内网穿透，跑在无头服务器上没问题。

### 3. 调设置

**设置** 页可以改：

- 自动抓取文章链接（默认开）
- 下载文章内图片到本地（默认开，微信图片链接会过期，强烈建议开）
- 给微信发回执（默认开）
- OneDrive 自动上传（默认关）
- 镜像目录、时区、上传间隔
- 文章抓取测试（粘个链接就能看抓成什么样，不写入镜像）

---

## 开机自启动

管理界面 → **自启动** → **安装并启用自启动**。

程序会自动判断平台并生成对应的服务配置：

| 平台 | 方式 | 配置文件 |
|---|---|---|
| Linux | systemd user service | `~/.config/systemd/user/wxcollector.service` |
| macOS | launchd LaunchAgent | `~/Library/LaunchAgents/com.wxcollector.plist` |
| Windows | 不支持自动安装 | 用任务计划程序，或在 WSL 里用 systemd |

生成的配置里包含 `Restart=always`，崩溃后 5 秒自动重启；日志走 journald。

界面上的「查看服务配置」可以先预览要写入的内容，再决定是否安装。

### Linux 上让它真正免登录启动

systemd user service 默认只在你登录后才运行。要让机器开机就跑（不需要登录桌面），需要开 linger：

```bash
sudo loginctl enable-linger $USER
```

界面会显示 linger 当前状态。如果显示「未开启」，装完服务后记得执行上面这条命令，否则重启后要等登录才启动。

常用命令：

```bash
systemctl --user status wxcollector    # 状态
journalctl --user -u wxcollector -f    # 实时日志
systemctl --user restart wxcollector   # 重启
```

### macOS

```bash
launchctl list | grep wxcollector      # 状态
tail -f data/launchd.log               # 日志
```

### 不想用系统服务

也可以手动后台跑，配合 `nohup`：

```bash
nohup npm start > data/wxcollector.log 2>&1 &
```

但这种方式不会开机自启，崩溃也不会自动重启，不如系统服务可靠。

---

## 用法

### 发什么，得到什么

| 微信里发 | 落地结果 |
|---|---|
| 纯文字 | 追加到当天流水账 `2026-11-21.md`，带时间戳 |
| 公众号链接 | 自动抓成 Markdown 文章 → `2026-11-21 标题.md`（平铺根目录），配图统一存 `assets/` |
| 普通网页链接 | 同上，用 Readability 抽正文 |
| 图片 | 解密存 `attachments/YYYY-MM/`，流水账里嵌入 |
| 语音 | 微信自带 ASR 转写进流水账；音频转 WAV 一并保存 |
| 文件 / 视频 | 解密存 `attachments/` |
| 首行写 `#单独保存` | 正文另存为独立笔记 `notes/YYYY-MM-DD 标题.md`，流水账只留一行 |

### 目录结构

```
data/library/
├── 2026-11-21.md                     当天流水账
├── 2026-11-21 某篇文章.md             文章（全部平铺在根目录，不再按公众号分目录）
├── assets/<hash>.png                 所有文章配图（全库共用一份）
├── attachments/2026-11/              图片、语音、文件、视频
├── notes/                            独立笔记
└── index.md                          索引
```

> **2026-11-21 起改版**：文章不再按 `<公众号名>/` 分子目录，一律平铺在 library 根目录；
> 配图不再跟着公众号走，统一收进根目录的 `assets/`（md 与 assets 同级，正文里写 `assets/<hash>.png`）。
> 旧结构（`articles/<公众号>/…`）由 `scripts/migrate_flat_layout.py` 迁移，模板与代码已同步改掉。

OneDrive 上的路径就是你设置的 `remoteRoot`，下面保持同样的结构。

---

## 设计要点

**先落本地，再传云端。** 微信 CDN 的媒体链接带时效签名，必须收到消息时立刻下载。上传失败不影响本地内容，本地永远是完整的。

**上传不阻塞收消息。** 收消息的主循环只负责落盘，然后 `notifyUploader()` 叫醒上传器。上传器独立轮询，用 `(路径, 内容哈希)` 去重，重跑、重启都不会重复上传。

**幂等。** 消息用 `message_id` 唯一约束，`get_updates_buf` 游标持久化在 SQLite 里，重放不会产生重复笔记。

**限流不重试。** iLink 的实测经验：发送返回 `ret=-2` 是额度用完了，**每次重试都会延长惩罚**（原本 1 小时能恢复的，持续重试会拖到 15 小时以上）。所以这里失败一次就放弃，只记日志。

**鉴权失败立刻中断。** 上传时遇到 401 / `AADSTS` 类错误，剩下的文件必然也失败，直接中断整轮并标记需要重新登录，不浪费请求。

---

## 已知限制

这些是 iLink 协议本身的限制，不是实现问题：

| 限制 | 说明 |
|---|---|
| 不能进群 | 只能 1v1 私聊 |
| 24 小时窗口 | 你 24 小时没给机器人发消息，`context_token` 失效，主动推送发不出去。收集场景（你发它收）不受影响 |
| 主动推送约 10 条/24h | 超了返回 `ret=-2`。收集场景吃的是被动回复，不占这个额度 |
| 语音只能收不能发 | 官方插件也只做了收 |
| 公众号抓取非 100% | 图片型文章、需验证的页面会失败。失败时保留元信息和原始链接，不会存空文档 |
| 一次最多 10 条消息 / 10 个文件 | 超了要用户再发一条 |

---

## 项目结构

```
src/
├── main.ts       入口：加载配置、恢复登录、启动各组件
├── config.ts     配置读写、时区格式化
├── db.ts         SQLite（node:sqlite）表结构与查询
├── ilink.ts      iLink 协议客户端：扫码、长轮询、发消息、文本抽取
├── media.ts      CDN 下载、AES-128-ECB 解密、SILK→WAV
├── article.ts    文章抓取：微信专用 + Readability 通用，图片本地化
├── library.ts    本地镜像：流水账、独立笔记、文章笔记
├── pipeline.ts   一条消息 → 落盘的完整流水线
├── uploader.ts   OneDrive 上传队列（哈希去重）
├── onedrive.ts   Microsoft Graph + OAuth 设备码
├── loop.ts       微信消息主循环
├── autostart.ts  开机自启动（systemd / launchd）
├── server.ts     HTTP 服务与 API
└── ui.ts         单页管理界面（无构建步骤）

scripts/          一次性工具（迁移/清理，默认干跑）
├── migrate_flat_layout.py   旧嵌套结构 → 平铺结构
├── migrate_old_articles.py  修复历史文章元数据
└── sync_flat.ts             同步平铺结构到 OneDrive 并清理远端旧目录
```

数据都在 `data/`：

- `config.json` 配置
- `wxcollector.db` SQLite（消息、附件、文章、上传记录、凭据、游标）
- `library/` 镜像

> `data/` 里有 `bot_token` 和 `refresh_token`，别提交到版本库，别随便分享。

---

## 排查

**扫码后收不到消息** — 检查 `data/wxcollector.db` 里的账号是否写入；确认绑定后已在微信里发过消息。

**回执发不出去** — 大概率是额度用完了（`ret=-2`），或者 24 小时窗口过期。去微信里给机器人发一条消息刷新。

**OneDrive 上传失败** — 界面「记录 → 上传记录」里看具体错误。`AADSTS` 开头的都是 Azure 应用配置问题，重点检查「允许公共客户端流」是否设为是。

**公众号抓取失败** — 用「设置 → 文章抓取测试」单独试。返回「链接参数错误或已失效」说明链接本身无效；「正文过短」说明是图片型文章或需要验证。

**看日志** — 前台运行时直接看终端输出。
