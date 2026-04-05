#!/usr/bin/env python3
"""
Her gün 19:00 (Europe/Istanbul) günlük TEFAS bakım işini çalıştırır.
Akış:
1) Günlük fon sync
2) History incremental append
3) Derived rebuild + cache warm

Kullanım: proje kökünde PYTHONPATH=. python3 scripts/scheduler.py
veya: npx tsx scripts/tefas-daily-maintenance.ts zamanlamasını cron ile verin.
"""
import os
import subprocess
import sys
from pathlib import Path

try:
    from apscheduler.schedulers.blocking import BlockingScheduler
    from apscheduler.triggers.cron import CronTrigger
except ImportError:
    print("apscheduler gerekli: pip install -r scripts/requirements.txt", file=sys.stderr)
    sys.exit(1)


ROOT = Path(__file__).resolve().parents[1]


def job():
    env = {**os.environ, "FORCE_COLOR": "0"}
    r = subprocess.run(
        ["npx", "tsx", "scripts/tefas-daily-maintenance.ts"],
        cwd=str(ROOT),
        env=env,
    )
    print(f"[scheduler] tefas-daily-maintenance çıkış kodu: {r.returncode}")


def main():
    tz = os.environ.get("TEFAS_TZ", "Europe/Istanbul")
    hour = int(os.environ.get("TEFAS_HOUR", "19"))
    minute = int(os.environ.get("TEFAS_MINUTE", "0"))
    sched = BlockingScheduler(timezone=tz)
    sched.add_job(
        job,
        CronTrigger(hour=hour, minute=minute, timezone=tz),
        id="tefas_daily",
        replace_existing=True,
    )
    print(f"TEFAS zamanlayıcı: her gün {hour:02d}:{minute:02d} ({tz}). Ctrl+C ile çık.")
    sched.start()


if __name__ == "__main__":
    main()
