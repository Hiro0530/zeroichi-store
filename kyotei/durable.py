"""学習用の履歴(読み取った数字だけ)を、非公開リポジトリ Hiro0530/arbitrage-scout の kyotei_data/ に控える。

Actions のキャッシュは7日間使われないと消えるので、その控え。生ファイルは入れない(もともと保存していない)。
- pull <dir>: 控えから、キャッシュに無い日だけ hist/ に戻す
- push <dir>: hist/ を月ごとの束(tar、中身は日ごとの json.gz)にして控えに書く。変わった月だけ書き換わる
"""
from __future__ import annotations

import io
import sys
import tarfile
from pathlib import Path

HIST = Path(__file__).resolve().parent / "hist"


def _members(t: tarfile.TarFile):
    for m in t.getmembers():
        p = Path(m.name)
        if m.isfile() and not p.is_absolute() and ".." not in p.parts:
            yield m, p


def pull(dst: Path):
    HIST.mkdir(exist_ok=True)
    got = 0
    for tf in sorted(dst.glob("*.tar")):
        with tarfile.open(tf) as t:
            for m, p in _members(t):
                out = HIST / p
                if out.exists():
                    continue
                out.parent.mkdir(parents=True, exist_ok=True)
                out.write_bytes(t.extractfile(m).read())
                got += 1
    print(f"durable pull: restored {got} files")


def _pack(files: list[Path]) -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w") as t:
        for f in sorted(files):
            info = tarfile.TarInfo(str(f.relative_to(HIST)))
            data = f.read_bytes()
            info.size = len(data)
            info.mtime = 0
            t.addfile(info, io.BytesIO(data))
    return buf.getvalue()


def push(dst: Path):
    dst.mkdir(parents=True, exist_ok=True)
    groups: dict[str, list[Path]] = {}
    for f in HIST.glob("*.json.gz"):
        groups.setdefault(f"hist_{f.name[:6]}", []).append(f)
    for sub in ("fan", "jma"):
        fs = [f for f in (HIST / sub).rglob("*") if f.is_file()] if (HIST / sub).exists() else []
        if fs:
            groups[sub] = fs
    changed = 0
    for name, fs in groups.items():
        out = dst / f"{name}.tar"
        b = _pack(fs)
        if not out.exists() or out.read_bytes() != b:
            out.write_bytes(b)
            changed += 1
    print(f"durable push: {len(groups)} bundles, {changed} changed")


if __name__ == "__main__":
    {"pull": pull, "push": push}[sys.argv[1]](Path(sys.argv[2]))
