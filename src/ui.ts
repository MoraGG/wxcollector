/**
 * 单页管理界面。刻意不用框架 —— 一个自包含的 HTML 字符串，
 * 打开就能用，不需要构建步骤。
 */

export function renderUI(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>wxcollector · 微信收集器</title>
<style>
  :root {
    --bg: #0f1115;
    --panel: #171a21;
    --panel-2: #1e222b;
    --border: #2a2f3a;
    --text: #e4e7ee;
    --dim: #8b93a7;
    --accent: #4f8cff;
    --ok: #35c07f;
    --warn: #e0a33e;
    --err: #e2565c;
    --radius: 10px;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font: 14px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    background: var(--bg);
    color: var(--text);
  }
  header {
    display: flex; align-items: center; gap: 16px;
    padding: 14px 24px;
    border-bottom: 1px solid var(--border);
    background: var(--panel);
    position: sticky; top: 0; z-index: 10;
  }
  header h1 { font-size: 15px; margin: 0; font-weight: 600; letter-spacing: .3px; }
  .badge { font-size: 12px; padding: 2px 8px; border-radius: 20px; background: var(--panel-2); color: var(--dim); }
  .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 6px; }
  .dot.on { background: var(--ok); box-shadow: 0 0 8px var(--ok); }
  .dot.off { background: var(--err); }
  .dot.idle { background: var(--dim); }

  nav { display: flex; gap: 4px; padding: 0 24px; border-bottom: 1px solid var(--border); background: var(--panel); }
  nav button {
    background: none; border: none; color: var(--dim); padding: 12px 16px;
    cursor: pointer; font-size: 14px; border-bottom: 2px solid transparent; font-family: inherit;
  }
  nav button.active { color: var(--text); border-bottom-color: var(--accent); }
  nav button:hover { color: var(--text); }

  main { padding: 24px; max-width: 1100px; margin: 0 auto; }
  .panel { display: none; }
  .panel.active { display: block; }

  .card {
    background: var(--panel); border: 1px solid var(--border);
    border-radius: var(--radius); padding: 20px; margin-bottom: 16px;
  }
  .card h2 { font-size: 14px; margin: 0 0 4px; font-weight: 600; }
  .card .hint { color: var(--dim); font-size: 12.5px; margin: 0 0 16px; }
  .card h2 + .hint { margin-top: 4px; }

  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
  .stat { background: var(--panel-2); border-radius: 8px; padding: 12px 14px; }
  .stat .k { color: var(--dim); font-size: 12px; }
  .stat .v { font-size: 18px; font-weight: 600; margin-top: 2px; }
  .stat .v.small { font-size: 13px; font-weight: 500; word-break: break-all; }

  .btn {
    background: var(--accent); color: #fff; border: none; border-radius: 7px;
    padding: 8px 16px; font-size: 13.5px; cursor: pointer; font-family: inherit;
    display: inline-block; text-decoration: none; line-height: 1.5;
  }
  .btn:hover { filter: brightness(1.1); }
  .btn:disabled { opacity: .5; cursor: not-allowed; }
  .btn.ghost { background: var(--panel-2); color: var(--text); border: 1px solid var(--border); }
  .btn.danger { background: var(--err); }
  .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }

  label.field { display: block; margin-bottom: 14px; }
  label.field .lab { display: block; font-size: 12.5px; color: var(--dim); margin-bottom: 5px; }
  input[type=text], input[type=password], input[type=number], select, textarea {
    width: 100%; background: var(--bg); border: 1px solid var(--border);
    border-radius: 7px; padding: 8px 11px; color: var(--text);
    font-family: inherit; font-size: 13.5px;
  }
  input:focus, select:focus, textarea:focus { outline: none; border-color: var(--accent); }
  textarea { resize: vertical; min-height: 90px; font-family: ui-monospace, monospace; font-size: 12.5px; }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  @media (max-width: 640px) { .two { grid-template-columns: 1fr; } }

  .switch { display: flex; align-items: center; gap: 9px; margin-bottom: 12px; cursor: pointer; }
  .switch input { width: auto; accent-color: var(--accent); }

  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); }
  th { color: var(--dim); font-weight: 500; font-size: 12px; }
  td.mono, .mono { font-family: ui-monospace, monospace; font-size: 12px; }
  tr:last-child td { border-bottom: none; }

  .tag { display: inline-block; font-size: 11.5px; padding: 1px 7px; border-radius: 5px; background: var(--panel-2); color: var(--dim); }
  .tag.ok { background: rgba(53,192,127,.15); color: var(--ok); }
  .tag.err { background: rgba(226,86,92,.15); color: var(--err); }
  .tag.warn { background: rgba(224,163,62,.15); color: var(--warn); }

  #qrbox { text-align: center; padding: 12px; }
  #qrbox img { width: 260px; height: 260px; background: #fff; border-radius: 10px; padding: 8px; }

  .toast {
    position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%) translateY(20px);
    background: var(--panel-2); border: 1px solid var(--border); border-radius: 8px;
    padding: 10px 18px; font-size: 13px; opacity: 0; transition: all .22s; pointer-events: none; z-index: 100;
    max-width: 80vw;
  }
  .toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
  .toast.err { border-color: var(--err); color: var(--err); }
  .toast.ok { border-color: var(--ok); color: var(--ok); }

  pre.preview {
    background: var(--bg); border: 1px solid var(--border); border-radius: 8px;
    padding: 12px; overflow: auto; max-height: 380px; font-size: 12px;
    font-family: ui-monospace, monospace; white-space: pre-wrap; word-break: break-word;
  }
  .muted { color: var(--dim); }
  code { background: var(--panel-2); padding: 1px 5px; border-radius: 4px; font-size: 12.5px; }
</style>
</head>
<body>

<header>
  <h1>微信收集器</h1>
  <span class="badge" id="hdr-wechat"><span class="dot idle"></span>未绑定</span>
  <span class="badge" id="hdr-onedrive"><span class="dot idle"></span>OneDrive 未登录</span>
  <span class="badge" id="hdr-count">0 条消息</span>
</header>

<nav>
  <button class="active" data-tab="overview">总览</button>
  <button data-tab="wechat">微信连接</button>
  <button data-tab="onedrive">OneDrive</button>
  <button data-tab="settings">设置</button>
  <button data-tab="autostart">自启动</button>
  <button data-tab="logs">记录</button>
</nav>

<main>
  <!-- ============ 总览 ============ -->
  <div class="panel active" id="tab-overview">
    <div class="card">
      <h2>运行状态</h2>
      <p class="hint">接收微信消息 → 落本地镜像 → 自动上传 OneDrive</p>
      <div class="grid" id="stats"></div>
    </div>
    <div class="card">
      <h2>操作</h2>
      <p class="hint">上传默认每 30 秒自动跑一轮，也可以手动立即触发</p>
      <div class="row">
        <button class="btn" onclick="manualSync(this)">立即同步到 OneDrive</button>
        <button class="btn ghost" onclick="retryUploads(this)">重试失败项</button>
        <button class="btn ghost" onclick="rebuildIndex(this)">重建索引</button>
      </div>
    </div>
    <div class="card">
      <h2>最近接收</h2>
      <p class="hint">最新的 10 条消息</p>
      <div id="recent-msgs"></div>
    </div>
  </div>

  <!-- ============ 微信 ============ -->
  <div class="panel" id="tab-wechat">
    <div class="card">
      <h2>绑定微信 ClawBot</h2>
      <p class="hint">
        用手机微信扫码并在手机上确认。绑定成功后<strong>必须先在微信里给机器人发一条消息</strong>，
        否则发送凭证不会下发，回执会失败。
      </p>
      <div id="qrbox" style="display:none"></div>
      <div class="row">
        <button class="btn" id="btn-login" onclick="startLogin(this)">扫码绑定</button>
        <button class="btn ghost" onclick="cancelLogin()">取消</button>
        <button class="btn danger" onclick="logoutWechat(this)">解除绑定</button>
      </div>
      <p class="muted" id="login-status" style="margin-top:12px"></p>
    </div>
    <div class="card">
      <h2>连接信息</h2>
      <div class="grid" id="wechat-info"></div>
    </div>
  </div>

  <!-- ============ OneDrive ============ -->
  <div class="panel" id="tab-onedrive">
    <div class="card">
      <h2>存储位置</h2>
      <p class="hint">决定内容最终存到 OneDrive 的哪里</p>
      <label class="switch">
        <input type="radio" name="od-mode" value="appfolder" id="od-mode-app" onchange="onModeChange()">
        <span>
          <strong>应用目录</strong>（默认，推荐）<br>
          <span class="muted" style="font-size:12px">存到 <code>OneDrive/应用/wxcollector/</code>，沙盒隔离，不会和你的其他文件混在一起</span>
        </span>
      </label>
      <label class="switch">
        <input type="radio" name="od-mode" value="full" id="od-mode-full" onchange="onModeChange()">
        <span>
          <strong>任意文件夹</strong><br>
          <span class="muted" style="font-size:12px">可以指定 <code>OneDrive/微信收集/</code> 这类路径，需要更宽的权限</span>
        </span>
      </label>
      <label class="field" id="od-root-field" style="display:none;margin-top:14px">
        <span class="lab">目标文件夹（相对 OneDrive 根目录）</span>
        <input type="text" id="od-root" placeholder="微信收集">
      </label>
      <p class="muted" id="od-target-preview" style="margin-top:10px"></p>
    </div>

    <div class="card">
      <h2>Azure 应用</h2>
      <p class="hint">
        默认使用内置应用，<strong>不需要填任何东西</strong>，点下面的「开始授权」即可。
      </p>
      <label class="switch">
        <input type="checkbox" id="od-custom-client" onchange="onCustomClientToggle()">
        <span>使用我自己的 Azure 应用（高级，可选）</span>
      </label>
      <div id="od-custom-box" style="display:none;margin-top:14px">
        <label class="field">
          <span class="lab">Application (client) ID</span>
          <input type="text" id="od-client-id" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx">
        </label>
        <label class="field">
          <span class="lab">租户（个人账号填 common）</span>
          <input type="text" id="od-tenant" placeholder="common">
        </label>
        <p class="hint">
          用自己的应用需要在 Azure 门户注册，并在「身份验证」里把<strong>「允许公共客户端流」</strong>设为<strong>是</strong>，
          再添加 Microsoft Graph 委托权限：<code>Files.ReadWrite</code>（或 <code>Files.ReadWrite.AppFolder</code>）、<code>User.Read</code>。
        </p>
      </div>
      <div class="row" style="margin-top:14px">
        <button class="btn ghost" onclick="saveODConfig(this)">保存设置</button>
      </div>
    </div>

    <div class="card">
      <h2>登录 OneDrive</h2>
      <p class="hint">点「开始授权」会给出一个验证码和网址，浏览器打开输入验证码即可</p>
      <div id="device-box" style="display:none">
        <div class="stat" style="margin-bottom:14px">
          <div class="k">验证码（复制到授权页面）</div>
          <div class="v mono" id="device-code" style="font-size:24px;letter-spacing:2px"></div>
        </div>
        <p class="hint" id="device-msg"></p>
        <div class="row">
          <a class="btn" id="device-link" target="_blank" style="text-decoration:none;display:inline-block">打开授权页面</a>
          <button class="btn ghost" onclick="copyCode()">复制验证码</button>
        </div>
        <p class="hint" id="device-wait" style="margin-top:12px">
          <span class="dot idle" style="vertical-align:middle"></span> 等待你在浏览器完成授权，完成后会自动登录，无需回到这里操作
        </p>
      </div>
      <div class="row" style="margin-top:12px">
        <button class="btn" id="btn-device" onclick="startDevice(this)">开始授权</button>
        <button class="btn danger" onclick="logoutOD(this)">退出登录</button>
      </div>
      <p class="muted" id="od-status" style="margin-top:12px"></p>
    </div>

    <div class="card">
      <h2>同步状态</h2>
      <div class="grid" id="od-info"></div>
    </div>
  </div>

  <!-- ============ 设置 ============ -->
  <div class="panel" id="tab-settings">
    <div class="card">
      <h2>功能开关</h2>
      <label class="switch"><input type="checkbox" id="cfg-article"> 自动抓取文章链接为 Markdown</label>
      <label class="switch"><input type="checkbox" id="cfg-download-images"> 下载文章内图片到本地（微信图片链接会过期，建议开）</label>
      <label class="switch"><input type="checkbox" id="cfg-reply"> 给微信发送回执</label>
      <label class="switch"><input type="checkbox" id="cfg-od-enabled"> 启用 OneDrive 自动上传</label>
    </div>

    <div class="card">
      <h2>本地镜像</h2>
      <label class="field">
        <span class="lab">镜像目录（收到内容先落这里）</span>
        <input type="text" id="cfg-library">
      </label>
      <div class="two">
        <label class="field">
          <span class="lab">时区</span>
          <input type="text" id="cfg-timezone" placeholder="Asia/Shanghai">
        </label>
        <label class="field">
          <span class="lab">上传间隔（秒）</span>
          <input type="number" id="cfg-interval" min="10" max="3600">
        </label>
      </div>
    </div>

    <div class="card">
      <h2>抓取参数</h2>
      <div class="two">
        <label class="field">
          <span class="lab">抓取超时（毫秒）</span>
          <input type="number" id="cfg-timeout" min="5000" max="120000">
        </label>
        <label class="field">
          <span class="lab">页面大小上限（字节）</span>
          <input type="number" id="cfg-maxbytes" min="1048576">
        </label>
      </div>
      <div class="row">
        <button class="btn" onclick="saveSettings(this)">保存设置</button>
      </div>
    </div>

    <div class="card">
      <h2>文章抓取测试</h2>
      <p class="hint">粘一个公众号链接或任意网页链接，看看能抓成什么样（不会写入镜像）</p>
      <label class="field">
        <span class="lab">链接</span>
        <input type="text" id="test-url" placeholder="https://mp.weixin.qq.com/s/...">
      </label>
      <div class="row">
        <button class="btn" onclick="testArticle(this)">测试抓取</button>
      </div>
      <div id="test-result" style="margin-top:14px"></div>
    </div>
  </div>

  <!-- ============ 自启动 ============ -->
  <div class="panel" id="tab-autostart">
    <div class="card">
      <h2>开机自启动</h2>
      <p class="hint">
        装成系统服务后，开机自动运行，崩溃自动重启，不需要一直开着终端窗口。
      </p>
      <div class="grid" id="auto-info"></div>
      <div class="row" style="margin-top:16px">
        <button class="btn" id="btn-auto-install" onclick="installAuto(this)">安装并启用自启动</button>
        <button class="btn danger" onclick="uninstallAuto(this)">停止并卸载</button>
        <button class="btn ghost" onclick="previewAuto(this)">查看服务配置</button>
      </div>
      <p class="muted" id="auto-msg" style="margin-top:12px"></p>
    </div>

    <div class="card" id="auto-detail-card" style="display:none">
      <h2>服务配置预览</h2>
      <p class="hint" id="auto-unit-path"></p>
      <pre class="preview" id="auto-unit-content"></pre>
    </div>

    <div class="card">
      <h2>安装后</h2>
      <p class="hint">Linux 用 systemd，macOS 用 launchd。常用命令：</p>
      <table>
        <thead><tr><th>操作</th><th>命令</th></tr></thead>
        <tbody>
          <tr><td>查看状态</td><td class="mono">systemctl --user status wxcollector</td></tr>
          <tr><td>查看日志</td><td class="mono">journalctl --user -u wxcollector -f</td></tr>
          <tr><td>重启</td><td class="mono">systemctl --user restart wxcollector</td></tr>
          <tr><td>开机免登录启动</td><td class="mono">sudo loginctl enable-linger $USER</td></tr>
        </tbody>
      </table>
      <p class="hint" style="margin-top:12px">
        macOS 对应命令：<code>launchctl list | grep wxcollector</code>，
        日志在 <code>data/launchd.log</code>。
      </p>
    </div>
  </div>

  <!-- ============ 记录 ============ -->
  <div class="panel" id="tab-logs">
    <div class="card">
      <h2>消息记录</h2>
      <div id="msg-table"></div>
    </div>
    <div class="card">
      <h2>文章记录</h2>
      <div id="article-table"></div>
    </div>
    <div class="card">
      <h2>上传记录</h2>
      <div id="upload-table"></div>
    </div>
  </div>
</main>

<div class="toast" id="toast"></div>

<script>
const $ = (s) => document.querySelector(s);
const api = async (p, opt = {}) => {
  const r = await fetch(p, {
    headers: { 'Content-Type': 'application/json' },
    ...opt,
    body: opt.body ? JSON.stringify(opt.body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
  return j;
};

let toastTimer;
function toast(msg, kind = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, 3200);
}

document.querySelectorAll('nav button').forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll('nav button').forEach((x) => x.classList.remove('active'));
    document.querySelectorAll('.panel').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    $('#tab-' + b.dataset.tab).classList.add('active');
    if (b.dataset.tab === 'logs') loadLogs();
    if (b.dataset.tab === 'settings') loadSettings();
    if (b.dataset.tab === 'onedrive') loadOD();
    if (b.dataset.tab === 'autostart') loadAuto();
  };
});

function fmtBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return n.toFixed(i ? 1 : 0) + ' ' + u[i];
}
function fmtTime(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  return d.toLocaleString('zh-CN', { hour12: false });
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ---------------- 状态轮询
async function refreshStatus() {
  try {
    const s = await api('/api/status');
    const w = s.wechat;
    const od = s.onedrive;

    // 顶栏
    const hw = $('#hdr-wechat');
    if (!w.bound) {
      hw.innerHTML = '<span class="dot idle"></span>未绑定微信';
    } else if (w.online) {
      hw.innerHTML = '<span class="dot on"></span>微信在线';
    } else if (w.needsRelogin) {
      hw.innerHTML = '<span class="dot off"></span>需重新扫码';
    } else {
      hw.innerHTML = '<span class="dot off"></span>微信离线';
    }

    const ho = $('#hdr-onedrive');
    if (!od.loggedIn) ho.innerHTML = '<span class="dot idle"></span>OneDrive 未登录';
    else if (od.lastError) ho.innerHTML = '<span class="dot off"></span>OneDrive 出错';
    else ho.innerHTML = '<span class="dot on"></span>OneDrive 已连接';

    $('#hdr-count').textContent = w.handled + ' 条已处理';

    // 总览统计
    const stats = [
      ['微信连接', w.bound ? (w.online ? '在线' : '离线') : '未绑定'],
      ['已处理消息', String(w.handled)],
      ['镜像文件', s.library.files + ' 个 / ' + fmtBytes(s.library.bytes)],
      ['待上传', String(s.pendingUploads)],
      ['附件', String((s.assets.pending || 0) + (s.assets.done || 0))],
      ['最后收消息', w.lastMessageAt ? fmtTime(w.lastMessageAt) : '—'],
    ];
    $('#stats').innerHTML = stats.map(([k, v]) =>
      '<div class="stat"><div class="k">' + k + '</div><div class="v small">' + esc(v) + '</div></div>'
    ).join('');

    // 微信信息
    $('#wechat-info').innerHTML = [
      ['绑定状态', w.bound ? '已绑定' : '未绑定'],
      ['Bot ID', w.botId || '—'],
      ['用户 ID', w.userId || '—'],
      ['绑定时间', w.savedAt ? fmtTime(new Date(w.savedAt).getTime()) : '—'],
      ['最后轮询', w.lastPollAt ? fmtTime(w.lastPollAt) : '—'],
      ['最后错误', w.lastError || '无'],
    ].map(([k, v]) => '<div class="stat"><div class="k">' + k + '</div><div class="v small">' + esc(v) + '</div></div>').join('');

    if (w.needsRelogin) {
      $('#login-status').innerHTML = '<span style="color:var(--err)">会话已过期，请重新扫码绑定</span>';
    }

    // OneDrive 信息
    $('#od-info').innerHTML = [
      ['登录状态', od.loggedIn ? '已登录' : '未登录'],
      ['运行中', od.running ? '是' : '否'],
      ['最后同步', od.lastRunAt ? fmtTime(od.lastRunAt) : '—'],
      ['本轮上传', String(od.lastUploaded)],
      ['累计上传', String(od.totalUploaded)],
      ['最后错误', od.lastError || '无'],
    ].map(([k, v]) => '<div class="stat"><div class="k">' + k + '</div><div class="v small">' + esc(v) + '</div></div>').join('');
  } catch (e) { /* 静默 */ }
}

// ---------------- 微信登录
let loginPoller;
async function startLogin(btn) {
  btn.disabled = true;
  try {
    const r = await api('/api/login/start', { method: 'POST' });
    $('#qrbox').style.display = 'block';
    $('#qrbox').innerHTML = '<img src="' + r.qrDataUrl + '" alt="二维码">';
    $('#login-status').textContent = '请用微信扫码';
    clearInterval(loginPoller);
    loginPoller = setInterval(async () => {
      const s = await api('/api/login/poll').catch(() => null);
      if (!s) return;
      if (s.status === 'scaned') $('#login-status').textContent = '已扫码，请在手机上确认';
      if (s.status === 'confirmed') {
        clearInterval(loginPoller);
        $('#login-status').innerHTML = '<span style="color:var(--ok)">绑定成功！现在去微信里给机器人发一条消息激活</span>';
        $('#qrbox').style.display = 'none';
        toast('微信绑定成功', 'ok');
        refreshStatus();
      }
      if (s.qrDataUrl && $('#qrbox').style.display !== 'none') {
        const img = $('#qrbox img');
        if (img && img.src !== s.qrDataUrl) img.src = s.qrDataUrl;
      }
    }, 1500);
  } catch (e) {
    toast('获取二维码失败: ' + e.message, 'err');
  } finally {
    btn.disabled = false;
  }
}
function cancelLogin() {
  clearInterval(loginPoller);
  $('#qrbox').style.display = 'none';
  $('#login-status').textContent = '';
  api('/api/login/cancel', { method: 'POST' }).catch(() => {});
}
async function logoutWechat(btn) {
  if (!confirm('确定解除微信绑定？需要重新扫码才能恢复。')) return;
  btn.disabled = true;
  try {
    await api('/api/logout', { method: 'POST' });
    clearInterval(loginPoller);
    $('#qrbox').style.display = 'none';
    $('#login-status').textContent = '已解除绑定';
    toast('已解除绑定');
    refreshStatus();
  } catch (e) { toast(e.message, 'err'); }
  finally { btn.disabled = false; }
}

// ---------------- OneDrive
function currentMode() {
  return document.querySelector('input[name="od-mode"]:checked')?.value || 'appfolder';
}

function onModeChange() {
  const mode = currentMode();
  $('#od-root-field').style.display = mode === 'full' ? 'block' : 'none';
  updateTargetPreview();
}

function onCustomClientToggle() {
  $('#od-custom-box').style.display = $('#od-custom-client').checked ? 'block' : 'none';
}

function updateTargetPreview() {
  const mode = currentMode();
  const root = ($('#od-root')?.value || '').trim() || '微信收集';
  $('#od-target-preview').innerHTML = mode === 'appfolder'
    ? '内容将存到：<code>OneDrive/应用/wxcollector/</code>'
    : '内容将存到：<code>OneDrive/' + esc(root) + '/</code>';
}

async function saveODConfig(btn) {
  btn.disabled = true;
  try {
    const custom = $('#od-custom-client').checked;
    await api('/api/config', {
      method: 'PUT',
      body: { onedrive: {
        mode: currentMode(),
        clientId: custom ? $('#od-client-id').value.trim() : '',
        tenant: custom ? ($('#od-tenant').value.trim() || 'common') : 'common',
        remoteRoot: $('#od-root').value.trim() || '微信收集',
      } },
    });
    toast('已保存', 'ok');
    loadOD();
  } catch (e) { toast(e.message, 'err'); }
  finally { btn.disabled = false; }
}

async function startDevice(btn) {
  btn.disabled = true;
  $('#od-status').textContent = '正在向 Microsoft 申请授权码…';
  try {
    const r = await api('/api/onedrive/device', { method: 'POST' });
    $('#device-box').style.display = 'block';
    $('#device-code').textContent = r.user_code;
    $('#device-msg').innerHTML = '在浏览器打开 <a href="' + esc(r.verification_uri) + '" target="_blank" style="color:var(--accent)">' + esc(r.verification_uri) + '</a> 并输入上面的验证码。';
    $('#device-link').href = r.verification_uri;
    $('#od-status').textContent = '';
    startOdWatch();
    toast('请在浏览器打开链接并输入代码', 'ok');
  } catch (e) {
    $('#device-box').style.display = 'none';
    const msg = e.message || '未知错误';
    // Azure 的错误码对普通用户没意义，翻译成人话
    let hint = msg;
    if (/AADSTS50059|tenant/i.test(msg)) {
      hint = '租户配置有问题：个人账号请在「租户」里填 common，并确认 Azure 应用的账户类型包含个人 Microsoft 账户。';
    } else if (/AADSTS700016|application.*not found/i.test(msg)) {
      hint = '找不到这个应用：检查 Application (client) ID 是否填对。';
    } else if (/AADSTS7000218|client_secret/i.test(msg)) {
      hint = '需要在 Azure 应用里把「允许公共客户端流」设为「是」。';
    } else if (/AADSTS65001|consent/i.test(msg)) {
      hint = '缺少授权：请在 Azure 应用的「API 权限」里添加 Files.ReadWrite 和 User.Read，并授予管理员同意。';
    }
    $('#od-status').innerHTML = '<span style="color:var(--err)">授权失败：' + esc(hint) + '</span>';
    toast('授权失败，请看下方说明', 'err');
  } finally { btn.disabled = false; }
}

let odWatch;
function copyCode() {
  const code = $('#device-code').textContent || '';
  navigator.clipboard?.writeText(code).then(
    () => toast('验证码已复制', 'ok'),
    () => toast('复制失败，请手动选中', 'err'),
  );
}

/** 后台自动轮询授权结果，用户不用再点任何按钮 */
function startOdWatch() {
  clearInterval(odWatch);
  odWatch = setInterval(async () => {
    const s = await api('/api/onedrive/watch').catch(() => null);
    if (!s) return;
    if (s.loggedIn || s.status === 'ok') {
      clearInterval(odWatch);
      $('#device-box').style.display = 'none';
      $('#od-status').innerHTML = '<span style="color:var(--ok)">已登录：' + esc(s.account?.displayName || '') + '</span>';
      $('#cfg-od-enabled').checked = true;
      toast('OneDrive 登录成功，已自动启用上传', 'ok');
      refreshStatus();
      // 顺手把上传开关打开并保存
      api('/api/config', { method: 'PUT', body: { onedrive: { enabled: true } } }).catch(() => {});
      return;
    }
    if (s.status === 'expired') {
      clearInterval(odWatch);
      $('#device-box').style.display = 'none';
      $('#od-status').innerHTML = '<span style="color:var(--err)">授权码已过期，请重新点击「开始授权」</span>';
      toast('授权码已过期', 'err');
    }
  }, 2500);
}

async function logoutOD(btn) {
  if (!confirm('确定退出 OneDrive 登录？')) return;
  btn.disabled = true;
  try {
    await api('/api/onedrive/logout', { method: 'POST' });
    clearInterval(odWatch);
    $('#device-box').style.display = 'none';
    $('#od-status').textContent = '已退出';
    toast('已退出');
    refreshStatus();
  } catch (e) { toast(e.message, 'err'); }
  finally { btn.disabled = false; }
}

async function loadOD() {
  try {
    const cfg = await api('/api/config');
    const mode = cfg.onedrive.mode || 'appfolder';
    document.querySelectorAll('input[name="od-mode"]').forEach((r) => {
      r.checked = r.value === mode;
    });
    const hasCustom = !!(cfg.onedrive.clientId || '').trim();
    $('#od-custom-client').checked = hasCustom;
    $('#od-custom-box').style.display = hasCustom ? 'block' : 'none';
    $('#od-client-id').value = cfg.onedrive.clientId || '';
    $('#od-tenant').value = cfg.onedrive.tenant || 'common';
    $('#od-root').value = cfg.onedrive.remoteRoot || '';
    onModeChange();
    const s = await api('/api/onedrive/status');
    if (s.loggedIn) {
      $('#od-status').innerHTML = '<span style="color:var(--ok)">已登录：' + esc(s.account?.displayName || '') + ' · 存到 ' + esc(s.remoteTarget || '') + '</span>';
      $('#device-box').style.display = 'none';
    } else if (s.deviceCode) {
      $('#device-box').style.display = 'block';
      $('#device-code').textContent = s.deviceCode.userCode;
      $('#device-msg').textContent = s.deviceCode.message;
      $('#device-link').href = s.deviceCode.uri;
    } else {
      $('#od-status').textContent = '未登录';
    }
  } catch (e) { /* ignore */ }
}

// ---------------- 设置
async function loadSettings() {
  try {
    const c = await api('/api/config');
    $('#cfg-article').checked = c.article.enabled;
    $('#cfg-download-images').checked = c.article.downloadImages;
    $('#cfg-reply').checked = c.reply.enabled;
    $('#cfg-od-enabled').checked = c.onedrive.enabled;
    $('#cfg-library').value = c.libraryDir;
    $('#cfg-timezone').value = c.timezone;
    $('#cfg-interval').value = c.upload.intervalSec;
    $('#cfg-timeout').value = c.article.timeoutMs;
    $('#cfg-maxbytes').value = c.article.maxBytes;
  } catch (e) { /* ignore */ }
}

async function saveSettings(btn) {
  btn.disabled = true;
  try {
    await api('/api/config', {
      method: 'PUT',
      body: {
        libraryDir: $('#cfg-library').value.trim(),
        timezone: $('#cfg-timezone').value.trim() || 'Asia/Shanghai',
        article: {
          enabled: $('#cfg-article').checked,
          downloadImages: $('#cfg-download-images').checked,
          timeoutMs: Number($('#cfg-timeout').value),
          maxBytes: Number($('#cfg-maxbytes').value),
        },
        reply: { enabled: $('#cfg-reply').checked },
        onedrive: { enabled: $('#cfg-od-enabled').checked },
        upload: { intervalSec: Number($('#cfg-interval').value) },
      },
    });
    toast('设置已保存', 'ok');
    refreshStatus();
  } catch (e) { toast(e.message, 'err'); }
  finally { btn.disabled = false; }
}

async function testArticle(btn) {
  const url = $('#test-url').value.trim();
  if (!url) return toast('请填写链接', 'err');
  btn.disabled = true;
  $('#test-result').innerHTML = '<p class="muted">抓取中…</p>';
  try {
    const r = await api('/api/test/article', { method: 'POST', body: { url } });
    if (!r.ok) {
      $('#test-result').innerHTML = '<p style="color:var(--err)">失败：' + esc(r.reason) + '</p>';
      return;
    }
    $('#test-result').innerHTML =
      '<div class="grid" style="margin-bottom:12px">' +
      [['标题', r.title], ['作者', r.author || '—'], ['类型', r.isWechat ? '公众号' : '普通网页'],
       ['图片', r.images + ' 张'], ['字数', r.chars]].map(([k, v]) =>
        '<div class="stat"><div class="k">' + k + '</div><div class="v small">' + esc(v) + '</div></div>').join('') +
      '</div><pre class="preview">' + esc(r.preview) + '</pre>';
  } catch (e) {
    $('#test-result').innerHTML = '<p style="color:var(--err)">' + esc(e.message) + '</p>';
  } finally { btn.disabled = false; }
}

// ---------------- 记录
async function loadLogs() {
  try {
    const [msgs, arts, ups] = await Promise.all([
      api('/api/messages?limit=50'),
      api('/api/articles?limit=30'),
      api('/api/uploads?limit=30'),
    ]);

    $('#msg-table').innerHTML = msgs.length ? '<table><thead><tr><th>时间</th><th>类型</th><th>内容</th><th>状态</th><th>笔记</th></tr></thead><tbody>' +
      msgs.map((m) => '<tr><td class="mono">' + fmtTime(m.created_at) + '</td><td><span class="tag">' + esc(m.kind) + '</span></td>' +
        '<td>' + esc((m.text || '').slice(0, 60)) + '</td>' +
        '<td><span class="tag ' + (m.status === 'done' ? 'ok' : m.status === 'failed' ? 'err' : '') + '">' + esc(m.status) + '</span></td>' +
        '<td class="mono muted">' + esc(m.note_path || '—') + '</td></tr>').join('') + '</tbody></table>'
      : '<p class="muted">还没有消息</p>';

    $('#article-table').innerHTML = arts.length ? '<table><thead><tr><th>时间</th><th>标题</th><th>状态</th><th>文件</th></tr></thead><tbody>' +
      arts.map((a) => '<tr><td class="mono">' + fmtTime(a.created_at) + '</td>' +
        '<td>' + esc(a.title || a.url) + '</td>' +
        '<td><span class="tag ' + (a.status === 'done' ? 'ok' : a.status === 'failed' ? 'err' : '') + '">' + esc(a.status) + '</span>' +
        (a.error ? '<br><span class="muted" style="font-size:11px">' + esc(a.error) + '</span>' : '') + '</td>' +
        '<td class="mono muted">' + esc(a.local_path || '—') + '</td></tr>').join('') + '</tbody></table>'
      : '<p class="muted">还没有文章</p>';

    $('#upload-table').innerHTML = ups.length ? '<table><thead><tr><th>时间</th><th>文件</th><th>大小</th><th>状态</th></tr></thead><tbody>' +
      ups.map((u) => '<tr><td class="mono">' + fmtTime(u.uploaded_at) + '</td>' +
        '<td class="mono">' + esc(u.rel) + '</td>' +
        '<td class="mono">' + fmtBytes(u.size) + '</td>' +
        '<td><span class="tag ' + (u.status === 'done' ? 'ok' : 'err') + '">' + esc(u.status) + '</span>' +
        (u.error ? '<br><span class="muted" style="font-size:11px">' + esc(u.error) + '</span>' : '') + '</td></tr>').join('') + '</tbody></table>'
      : '<p class="muted">还没有上传记录</p>';
  } catch (e) { /* ignore */ }
}

async function loadRecent() {
  try {
    const msgs = await api('/api/messages?limit=10');
    $('#recent-msgs').innerHTML = msgs.length ? '<table><thead><tr><th>时间</th><th>类型</th><th>内容</th></tr></thead><tbody>' +
      msgs.map((m) => '<tr><td class="mono">' + fmtTime(m.created_at) + '</td>' +
        '<td><span class="tag">' + esc(m.kind) + '</span></td>' +
        '<td>' + esc((m.text || '').slice(0, 80)) + '</td></tr>').join('') + '</tbody></table>'
      : '<p class="muted">还没有收到消息。绑定微信后，给机器人发一条试试。</p>';
  } catch (e) { /* ignore */ }
}

// ---------------- 操作
async function manualSync(btn) {
  btn.disabled = true;
  try {
    const r = await api('/api/sync', { method: 'POST' });
    if (r.error) toast('同步失败: ' + r.error, 'err');
    else toast('上传 ' + r.uploaded + ' 个，跳过 ' + r.skipped + ' 个，失败 ' + r.failed + ' 个', 'ok');
    refreshStatus();
  } catch (e) { toast(e.message, 'err'); }
  finally { btn.disabled = false; }
}
async function retryUploads(btn) {
  btn.disabled = true;
  try {
    const r = await api('/api/retry-uploads', { method: 'POST' });
    toast('已重置 ' + r.reset + ' 条记录，正在重试', 'ok');
  } catch (e) { toast(e.message, 'err'); }
  finally { btn.disabled = false; }
}
async function rebuildIndex(btn) {
  btn.disabled = true;
  try {
    await api('/api/rebuild-index', { method: 'POST' });
    toast('索引已重建', 'ok');
  } catch (e) { toast(e.message, 'err'); }
  finally { btn.disabled = false; }
}

// ---------------- 自启动
async function loadAuto() {
  try {
    const st = await api('/api/autostart');
    const rows = [
      ['平台', st.platform === 'linux' ? 'Linux (systemd)' : st.platform === 'darwin' ? 'macOS (launchd)' : st.platform],
      ['已安装', st.installed ? '是' : '否'],
      ['运行中', st.active ? '是' : '否'],
      ['开机自启', st.enabled ? '已启用' : '未启用'],
      ['linger', st.linger === undefined ? '—' : (st.linger ? '已开启（免登录启动）' : '未开启')],
    ];
    $('#auto-info').innerHTML = rows.map(([k, v]) =>
      '<div class="stat"><div class="k">' + k + '</div><div class="v small">' + esc(v) + '</div></div>'
    ).join('');

    const btn = $('#btn-auto-install');
    if (!st.supported) {
      btn.disabled = true;
      $('#auto-msg').innerHTML = '<span style="color:var(--warn)">' + esc(st.message || '当前平台不支持自动安装') + '</span>';
    } else {
      btn.disabled = st.installed && st.enabled && st.active;
      btn.textContent = st.installed ? (st.active ? '已安装并运行' : '重新安装') : '安装并启用自启动';
      $('#auto-msg').textContent = st.message || '';
      if (st.unitPath) $('#auto-msg').textContent += (st.message ? ' · ' : '') + st.unitPath;
    }
  } catch (e) { toast(e.message, 'err'); }
}

async function installAuto(btn) {
  btn.disabled = true;
  try {
    const r = await api('/api/autostart/install', { method: 'POST' });
    if (r.ok) {
      toast('自启动已安装', 'ok');
      if (r.status?.message) toast(r.status.message, 'err');
    } else {
      toast(r.error || '安装失败', 'err');
    }
    loadAuto();
  } catch (e) { toast(e.message, 'err'); }
  finally { btn.disabled = false; }
}

async function uninstallAuto(btn) {
  if (!confirm('确定停止并卸载开机自启动？当前运行的服务会被停止。')) return;
  btn.disabled = true;
  try {
    await api('/api/autostart/uninstall', { method: 'POST' });
    toast('已卸载自启动', 'ok');
    loadAuto();
  } catch (e) { toast(e.message, 'err'); }
  finally { btn.disabled = false; }
}

async function previewAuto(btn) {
  btn.disabled = true;
  try {
    const r = await api('/api/autostart/preview');
    if (!r.content) { toast('当前平台无可预览配置', 'err'); return; }
    $('#auto-detail-card').style.display = 'block';
    $('#auto-unit-path').textContent = r.path;
    $('#auto-unit-content').textContent = r.content;
    $('#auto-detail-card').scrollIntoView({ behavior: 'smooth' });
  } catch (e) { toast(e.message, 'err'); }
  finally { btn.disabled = false; }
}

// 目标路径实时预览
document.getElementById('od-root')?.addEventListener('input', updateTargetPreview);

// ---------------- 启动
refreshStatus();
loadRecent();
setInterval(refreshStatus, 3000);
setInterval(() => {
  if ($('#tab-overview').classList.contains('active')) loadRecent();
}, 10000);
</script>
</body>
</html>`;
}
