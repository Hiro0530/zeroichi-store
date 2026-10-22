"""kyotei: entry point. modes: sample | backfill | daily"""
import sys, subprocess, tempfile, time, urllib.request
from pathlib import Path
from datetime import date, timedelta

ROOT = Path(__file__).resolve().parent
BASE = "https://www1.mbrace.or.jp/od2"
UA = "kyotei-kotaeawase/0.1 (+low-frequency daily fetch)"


def fetch(kind: str, d: date) -> str:
    """kind: 'B'(番組表) or 'K'(競走成績). Returns decoded text ('' if missing)."""
    url = f"{BASE}/{kind}/{d:%Y%m}/{kind.lower()}{d:%y%m%d}.lzh"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        data = urllib.request.urlopen(req, timeout=60).read()
    except Exception as e:  # noqa
        print(f"miss {url}: {e}")
        return ""
    time.sleep(1.0)
    with tempfile.TemporaryDirectory() as t:
        p = Path(t) / "x.lzh"
        p.write_bytes(data)
        subprocess.run(["lha", "-xq", str(p)], cwd=t, check=False)
        texts = [f.read_bytes().decode("cp932", errors="replace")
                 for f in Path(t).iterdir() if f.name != "x.lzh" and f.is_file()]
    return "\n".join(texts)


def mode_sample():
    out = ROOT / "samples"
    out.mkdir(exist_ok=True)
    d = date.today() - timedelta(days=2)
    for kind in ("B", "K"):
        txt = fetch(kind, d)
        lines = txt.splitlines()
        print(kind, d, len(lines), "lines")
        (out / f"{kind}_{d:%Y%m%d}_head.txt").write_text("\n".join(lines[:700]), encoding="utf-8")
    t = fetch("B", date.today())
    print("B today lines:", len(t.splitlines()))
    t = fetch("K", date.today() - timedelta(days=1))
    print("K yesterday lines:", len(t.splitlines()))


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "daily"
    if mode == "sample":
        mode_sample()
    else:
        from engine import main  # type: ignore
        main(mode)
