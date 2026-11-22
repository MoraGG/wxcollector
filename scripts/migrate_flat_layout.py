#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把 wxcollector 的 library 从「articles/<公众号>/xxx.md + <公众号>/assets/」
改成「文章平铺根目录 + 全库统一 assets/」。

用法:
    python3 scripts/migrate_flat_layout.py                 # 干跑：只打印要做什么
    python3 scripts/migrate_flat_layout.py --apply         # 真跑
    python3 scripts/migrate_flat_layout.py --apply --root /path/to/library

搬运规则:
    <root>/articles/<账号>/<日期 标题>.md   → <root>/<日期 标题>.md
    <root>/articles/<账号>/assets/<hash>.png → <root>/assets/<hash>.png
    然后删除空的 articles/ 目录树

安全性:
    - 目标已存在同名文件时，加 (2)/(3) 后缀，不覆盖
    - 图片按内容 sha256 比对：同名同内容直接跳过，同名不同内容另存并报警
    - 干跑模式不写任何东西
    - --copy 模式（默认给 CloudFS 用）：先复制+校验，再删除源文件
"""

import argparse
import filecmp
import hashlib
import os
import shutil
import sys
from pathlib import Path

# 默认取仓库根目录下的 data/library，可用 --root 覆盖
DEFAULT_ROOT = Path(__file__).resolve().parent.parent / "data" / "library"


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def unique_target(dst_dir: Path, name: str) -> Path:
    dst = dst_dir / name
    if not dst.exists():
        return dst
    stem, ext = os.path.splitext(name)
    n = 2
    while True:
        cand = dst_dir / f"{stem} ({n}){ext}"
        if not cand.exists():
            return cand
        n += 1


def migrate(root: Path, apply: bool, mode: str) -> int:
    articles = root / "articles"
    assets_dst = root / "assets"
    if not articles.is_dir():
        print(f"[跳过] {root} 下没有 articles/ 目录（可能已经是新结构）")
        return 0

    moves_md: list[tuple[Path, Path]] = []
    moves_img: list[tuple[Path, Path]] = []
    dupes: list[str] = []

    for acc in sorted([d for d in articles.iterdir() if d.is_dir()]):
        for f in sorted(acc.glob("*.md")):
            moves_md.append((f, unique_target(root, f.name)))
        adir = acc / "assets"
        if adir.is_dir():
            for f in sorted(adir.iterdir()):
                if not f.is_file():
                    continue
                tgt = assets_dst / f.name
                if tgt.exists():
                    if tgt.stat().st_size == f.stat().st_size and sha256(tgt) == sha256(f):
                        dupes.append(f"同内容重复（跳过）: {f.relative_to(root)}")
                        continue
                    tgt = unique_target(assets_dst, f.name)
                moves_img.append((f, tgt))

    print(f"===== {root} =====")
    print(f"  文章 md : {len(moves_md)} 个")
    print(f"  配图    : {len(moves_img)} 个")
    for f, t in moves_md:
        print(f"    md   {f.relative_to(root)}  ->  {t.name}")
    if moves_img:
        print(f"    图   共 {len(moves_img)} 个 -> assets/（示例 3 个）")
        for f, t in moves_img[:3]:
            print(f"         {f.relative_to(root)}  ->  assets/{t.name}")
    for d in dupes:
        print(f"    [注意] {d}")

    if not apply:
        print("  （干跑，未执行）")
        return 0

    assets_dst.mkdir(parents=True, exist_ok=True)
    if mode == "copy":
        # CloudFS 等网络挂载：复制 + 校验 + 再删源
        for src, dst in moves_md + moves_img:
            shutil.copy2(src, dst)
            if not filecmp.cmp(src, dst, shallow=False):
                print(f"  [错误] 复制校验失败: {src}", file=sys.stderr)
                return 1
            src.unlink()
    else:
        for src, dst in moves_md + moves_img:
            shutil.move(str(src), str(dst))

    # 清理空的 articles 目录树
    for d in sorted([d for d in articles.rglob("*") if d.is_dir()], key=lambda p: -len(p.parts)):
        try:
            d.rmdir()
        except OSError:
            pass
    try:
        articles.rmdir()
        print("  已删除空的 articles/ 目录")
    except OSError:
        print("  [注意] articles/ 未能删除（仍有内容）")

    print(f"  完成：md {len(moves_md)} 个、图 {len(moves_img)} 个已平铺")
    return 0


def verify(root: Path) -> int:
    """校验根目录下每个 md 的图片引用是否都能找到"""
    assets = root / "assets"
    bad = 0
    total = 0
    for md in sorted(root.glob("*.md")):
        text = md.read_text(encoding="utf-8", errors="replace")
        for line in text.splitlines():
            if "![" not in line or "](" not in line:
                continue
            start = line.find("](") + 2
            end = line.find(")", start)
            if end < 0:
                continue
            ref = line[start:end].strip()
            if ref.startswith(("http://", "https://")):
                continue
            total += 1
            p = root / ref if not ref.startswith("/") else Path(ref)
            if not p.exists():
                bad += 1
                print(f"  [断链] {md.name} -> {ref}")
    print(f"===== 校验 {root} =====")
    print(f"  本地图片引用 {total} 条，断链 {bad} 条")
    return 0 if bad == 0 else 1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=str(DEFAULT_ROOT))
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--copy", action="store_true", help="复制+校验+删源（给 CloudFS 用）")
    ap.add_argument("--verify-only", action="store_true")
    a = ap.parse_args()
    root = Path(a.root)
    if a.verify_only:
        return verify(root)
    rc = migrate(root, a.apply, "copy" if a.copy else "move")
    if a.apply:
        rc = max(rc, verify(root))
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
