/**
 * 一次性工具：把新的「平铺文章 + 统一 assets/」结构同步到 OneDrive，
 * 并清理远端残留的旧嵌套结构 `articles/<公众号>/...`。
 *
 * 用法（在 /home/tang/wxcollector 下）：
 *   node scripts/sync_flat.ts                  # 干跑：只列出远端 articles/ 里有什么
 *   node scripts/sync_flat.ts --upload         # 先上传本地新结构（syncOnce）
 *   node scripts/sync_flat.ts --prune --apply  # 真正删除远端 articles/（进 OneDrive 回收站）
 *   node scripts/sync_flat.ts --upload --prune --apply   # 一条龙
 *
 * 安全：默认全部干跑；删除只针对 remoteRoot 下的 `articles/` 子目录。
 */

import { getConfig } from "../src/config.ts";
import { getAccessToken } from "../src/onedrive.ts";
import { syncOnce } from "../src/uploader.ts";

const args = new Set(process.argv.slice(2));
const APPLY = args.has("--apply");
const DO_UPLOAD = args.has("--upload");
const DO_PRUNE = args.has("--prune");

const GRAPH = "https://graph.microsoft.com/v1.0";

function encodePath(p: string): string {
  return p
    .split("/")
    .filter(Boolean)
    .map((s) => encodeURIComponent(s))
    .join("/");
}

type Item = { id: string; name: string; folder?: { childCount: number }; file?: unknown; size?: number };

async function listChildren(token: string, pathRel: string): Promise<Item[]> {
  const out: Item[] = [];
  let url =
    `${GRAPH}/me/drive/root:/${encodePath(pathRel)}:/children` +
    `?$select=id,name,folder,file,size&$top=200`;
  while (url) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 404) return out;
    if (!res.ok) throw new Error(`list ${pathRel} -> HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = (await res.json()) as { value: Item[]; "@odata.nextLink"?: string };
    out.push(...j.value);
    url = j["@odata.nextLink"] ?? "";
  }
  return out;
}

async function walk(token: string, pathRel: string, acc: { path: string; id: string; isDir: boolean; size: number }[]) {
  for (const it of await listChildren(token, pathRel)) {
    const childRel = `${pathRel}/${it.name}`;
    if (it.folder) {
      await walk(token, childRel, acc);
      acc.push({ path: childRel, id: it.id, isDir: true, size: 0 });
    } else {
      acc.push({ path: childRel, id: it.id, isDir: false, size: it.size ?? 0 });
    }
  }
}

async function main() {
  const cfg = getConfig();
  const remoteRoot = cfg.onedrive.remoteRoot.replace(/^\/+|\/+$/g, "");
  console.log(`远程根: ${remoteRoot}`);
  console.log(`模式: ${APPLY ? "执行" : "干跑"}${DO_UPLOAD ? " + 上传" : ""}${DO_PRUNE ? " + 清理远端 articles/" : ""}`);

  if (DO_UPLOAD) {
    console.log("\n== 1) 上传本地新结构 ==");
    const r = await syncOnce(true);
    console.log(`  上传 ${r.uploaded} 个，跳过 ${r.skipped} 个，失败 ${r.failed} 个${r.error ? `（${r.error}）` : ""}`);
    if (r.error) process.exitCode = 1;
  }

  if (!DO_PRUNE) return;

  const token = await getAccessToken();
  const targetRel = `${remoteRoot}/articles`;
  console.log(`\n== 2) 远端 ${targetRel} ==`);
  const items: { path: string; id: string; isDir: boolean; size: number }[] = [];
  await walk(token, targetRel, items);
  if (!items.length) {
    console.log("  远端没有 articles/ 残留，无需清理");
    return;
  }
  const files = items.filter((i) => !i.isDir);
  const dirs = items.filter((i) => i.isDir);
  const bytes = files.reduce((s, f) => s + f.size, 0);
  console.log(`  待删文件 ${files.length} 个（${(bytes / 1024 / 1024).toFixed(1)} MB），目录 ${dirs.length} 个`);
  for (const f of files.slice(0, 8)) console.log(`    - ${f.path}`);
  if (files.length > 8) console.log(`    … 其余 ${files.length - 8} 个`);

  if (!APPLY) {
    console.log("\n  （干跑，未删除；加 --apply 才真正删）");
    return;
  }

  let ok = 0;
  let bad = 0;
  for (const it of items) {
    const res = await fetch(`${GRAPH}/me/drive/items/${it.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok || res.status === 404) ok++;
    else {
      bad++;
      console.log(`  [失败] ${it.path} -> HTTP ${res.status}`);
    }
  }
  console.log(`\n  已删除 ${ok} 项${bad ? `，失败 ${bad} 项` : ""}（OneDrive 回收站可恢复）`);
  if (bad) process.exitCode = 1;
}

main().catch((e) => {
  console.error("出错:", e instanceof Error ? e.message : e);
  process.exit(1);
});
