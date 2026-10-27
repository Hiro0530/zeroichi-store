"""GitHub の定時実行は混むと1.5〜3時間遅れることがある。早めに起動して、ここで決まった時刻(JST)まで待つ。
python kyotei/waituntil.py HH:MM [health.json] [label] [scheduled_cron_utc_HH:MM]
- すでに過ぎていれば待たない。
- health.json に「起動・待ち終わりの時刻、予定からの遅れ(分)」を足す(HQ の監視用)。"""
import json
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

JST = timezone(timedelta(hours=9))
now = datetime.now(JST)
h, m = map(int, sys.argv[1].split(":"))
target = now.replace(hour=h, minute=m, second=0, microsecond=0)
rec = {"label": sys.argv[3] if len(sys.argv) > 3 else "", "started_at": now.isoformat(timespec="seconds"), "wait_until": target.isoformat(timespec="minutes")}
if len(sys.argv) > 4 and sys.argv[4]:
    sh, sm = map(int, sys.argv[4].split(":"))
    sched = now.astimezone(timezone.utc).replace(hour=sh, minute=sm, second=0, microsecond=0)
    if sched > now.astimezone(timezone.utc) + timedelta(hours=1):
        sched -= timedelta(days=1)
    rec["scheduled_utc"] = sched.isoformat(timespec="minutes")
    rec["start_delay_min"] = round((now - sched).total_seconds() / 60)
wait = (target - now).total_seconds()
if wait > 0:
    print(f"waiting {wait/60:.0f} min until {target:%H:%M} JST")
    time.sleep(wait)
rec["waited_min"] = round(max(wait, 0) / 60)
if len(sys.argv) > 2 and sys.argv[2]:
    p = Path(sys.argv[2])
    p.parent.mkdir(parents=True, exist_ok=True)
    hist = json.loads(p.read_text()) if p.exists() else []
    hist = (hist + [rec])[-60:]
    p.write_text(json.dumps(hist, ensure_ascii=False, indent=1))
print(json.dumps(rec, ensure_ascii=False))
