#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把旧的「微信公众号文章」目录结构迁移成 wxcollector 的新结构。

旧：微信公众号文章/<日期> - <标题>.md  +  微信公众号文章/附件资源/<文件夹>/img_N.png
    图片引用：![x](../附件资源/<文件夹>/img_1.png)

新：articles/<公众号名>/<日期> 标题.md  +  articles/<公众号名>/assets/<hash>.png
    图片引用：![x](assets/<hash>.png)
    frontmatter：title / author / source / type: wechat-article / saved（ISO）

默认干跑（只打印），加 --apply 才真正写入。
"""
import argparse
import hashlib
import os
import re
import shutil
import sys
import urllib.parse
from datetime import datetime

OLD_DIR = "/home/tang/文档/Obsidian Vault/微信公众号文章"
LIB = "/home/tang/wxcollector/data/library"
ART = LIB  # 2026-11-21 第三版：文章平铺在库根，配图共用一个 library/assets/


def parse_fm(txt):
    m = re.match(r"^---\n(.*?)\n---\n", txt, re.S)
    if not m:
        return {}, txt
    body = txt[m.end():]
    fm = {}
    for line in m.group(1).splitlines():
        mm = re.match(r"^([A-Za-z_]+):\s*(.*)$", line)
        if mm:
            v = mm.group(2).strip()
            if v.startswith('"') and v.endswith('"'):
                v = v[1:-1]
            v = v.replace('\\"', '"')
            fm[mm.group(1)] = v
    return fm, body


def resolve_image(ref, old_dir):
    """把各种写法的图片引用解析成磁盘上的真实文件。"""
    q = ref.strip()
    # 去掉可能的前缀，统一成 附件资源/...
    for pref in ("微信公众号文章/", "../", "./"):
        while q.startswith(pref):
            q = q[len(pref):]
    cands = [q, urllib.parse.unquote(q)]
    for c in list(cands):
        cands.append(os.path.join(old_dir, c))
        cands.append(os.path.join(old_dir, "微信公众号文章", c))
    for c in cands:
        if os.path.isfile(c):
            return os.path.abspath(c)
    return None
def safe_name(s):
    """文件名里不能出现路径分隔符等字符（标题里的 / 会造出子目录）。
    frontmatter 里保留原标题，只净化文件名。"""
    for ch in '/\\:*?"<>|':
        s = s.replace(ch, "-")
    s = re.sub(r"\s+", " ", s).strip()
    return s[:120]


def asset_name(src_path):
    h = hashlib.md5(src_path.encode("utf-8")).hexdigest()[:16]
    ext = os.path.splitext(src_path)[1].lower() or ".png"
    return h + ext


def target_name(it):
    """目标文件名。若库里已有同名（仅日期前缀不同，例如无 frontmatter 的老文章
    会退化用 mtime 当日期），沿用已有文件名，避免同一篇出现两份。"""
    sn = safe_name(it["title"]) + ".md"
    try:
        for p in os.listdir(ART):
            if p.endswith(" " + sn):
                return p
    except OSError:
        pass
    return f'{it["date"]} {sn}'


def iso_saved(fm, fallback_mtime):
    s = fm.get("saved_at")
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(s, fmt).astimezone().isoformat(timespec="milliseconds").replace("+00:00", "Z")
        except (TypeError, ValueError):
            continue
    return datetime.fromtimestamp(fallback_mtime).astimezone().isoformat(timespec="milliseconds")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    a = ap.parse_args()

    files = sorted(f for f in os.listdir(OLD_DIR) if f.endswith(".md"))
    plan = []
    for fn in files:
        p = os.path.join(OLD_DIR, fn)
        txt = open(p, encoding="utf-8", errors="replace").read()
        fm, body = parse_fm(txt)
        mtime = os.path.getmtime(p)

        title = fm.get("title")
        if not title:
            h1 = re.search(r"^#\s+(.+)$", body, re.M)
            title = h1.group(1).strip() if h1 else os.path.splitext(fn)[0]
        account = fm.get("account") or "未分类"
        src = fm.get("source_url") or ""
        pub = (fm.get("published_at") or "").strip()
        date = pub[:10] if re.match(r"^\d{4}-\d{2}-\d{2}", pub) else datetime.fromtimestamp(mtime).strftime("%Y-%m-%d")

        # 图片：解析 + 计划改名
        refs = re.findall(r"(!\[[^\]]*\]\()([^)]+)(\))", body)
        img_map = {}
        missing = []
        for _, ref, _ in refs:
            if ref in img_map or ref in missing:
                continue
            real = resolve_image(ref, OLD_DIR)
            if real is None:
                missing.append(ref)
            else:
                img_map[ref] = real

        assets = {}
        for ref, real in img_map.items():
            assets[ref] = {"src": real, "name": asset_name(real)}

        plan.append(dict(old=fn, title=title, account=account, date=date, source=src,
                         saved=iso_saved(fm, mtime), body=body, refs=len(refs),
                         assets=assets, missing=missing))

    print(f"{'旧文件':<60} -> {'新路径'}")
    print("-" * 120)
    total_img = 0
    for it in plan:
        newrel = target_name(it)
        total_img += len(it["assets"])
        print(f'{it["old"][:58]:<60} -> {newrel}')
        print(f'     账号={it["account"]}  日期={it["date"]}  图片引用={it["refs"]}  可迁移图={len(it["assets"])}  缺图={len(it["missing"])}')
        for m in it["missing"][:3]:
            print(f'     ⚠️ 找不到: {m}')
    print("-" * 120)
    print(f"共 {len(plan)} 篇，图片 {total_img} 张需要复制到各账号 assets/")

    if not a.apply:
        print("\n[干跑] 未写入任何文件。确认无误后加 --apply 执行。")
        return 0

    made = 0
    for it in plan:
        adir = ART
        os.makedirs(os.path.join(ART, "assets"), exist_ok=True)
        # 复制图片
        for ref, meta in it["assets"].items():
            dst = os.path.join(adir, "assets", meta["name"])
            if not os.path.exists(dst):
                shutil.copy2(meta["src"], dst)
        # 重写图片引用
        newbody = it["body"]
        for ref, meta in it["assets"].items():
            newbody = newbody.replace(f"]({ref})", f"](assets/{meta['name']})")
        # 正文去掉已有的 H1 与「原文/作者」行，统一重建
        nb = re.sub(r"^\s*#\s+.*?\n", "", newbody, count=1)
        nb = re.sub(r"^\s*>\s*原文[:：].*?$", "", nb, count=1, flags=re.M)
        nb = re.sub(r"^\s*>\s*作者[:：].*?$", "", nb, count=1, flags=re.M)
        nb = nb.lstrip("\n")
        head = (
            "---\n"
            f'title: "{it["title"].replace(chr(34), chr(92)+chr(34))}"\n'
            f'author: "{it["account"]}"\n'
            f'source: "{it["source"]}"\n'
            "type: wechat-article\n"
            f'saved: {it["saved"]}\n'
            "---\n\n"
            f"# {it['title']}\n\n"
            f"> 原文：{it['source']}\n"
            f"> 作者：{it['account']}\n\n"
        )
        out = os.path.join(adir, target_name(it))
        tmp = out + ".hermes-tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            fh.write(head + nb)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, out)
        made += 1
        print(f"✅ {out}")

    print(f"\n完成：写入 {made} 篇。旧目录未删除，仍在 {OLD_DIR}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
