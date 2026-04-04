#!/usr/bin/env python3
"""
TEFAS verisini JSON olarak stdout'a yazar.
Başarısız / boş: mevcut DB'yi etkilememek için ts tarafı işlem yapmaz.
"""
import argparse
import contextlib
import io
import json
import math
import os
import sys
import traceback
from datetime import datetime, timedelta
from typing import Optional

try:
    from tefasfon import fetch_tefas_data
    import tefasfon.data_fetcher as tefas_data_fetcher
    from selenium import webdriver
    from selenium.webdriver.chrome.options import Options
except ImportError:
    print(
        json.dumps({"ok": False, "error": "tefasfon yok. pip install -r scripts/requirements.txt"}),
        file=sys.stderr,
    )
    sys.exit(2)


def find_chrome_binary() -> Optional[str]:
    env_binary = os.environ.get("TEFAS_CHROME_BIN", "").strip()
    candidates = [
        env_binary,
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/usr/bin/google-chrome",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
    ]
    for candidate in candidates:
        if candidate and os.path.exists(candidate):
            return candidate
    return None


def setup_local_webdriver(lang: str, headless: bool = True):
    chrome_options = Options()
    chrome_binary = find_chrome_binary()
    if chrome_binary:
        chrome_options.binary_location = chrome_binary

    if headless:
        chrome_options.add_argument("--headless=new")
        chrome_options.add_argument("--disable-gpu")
        chrome_options.add_argument("--window-size=1920,1080")

    chrome_options.add_argument("--lang=tr-TR")
    chrome_options.add_argument("--disable-notifications")
    chrome_options.add_argument("--disable-popup-blocking")
    chrome_options.add_argument("--disable-blink-features=AutomationControlled")
    chrome_options.add_argument("--log-level=3")
    chrome_options.add_experimental_option("excludeSwitches", ["enable-automation", "enable-logging"])
    chrome_options.add_experimental_option("useAutomationExtension", False)
    chrome_options.add_argument(
        "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36"
    )

    driver = webdriver.Chrome(options=chrome_options)
    driver.set_page_load_timeout(45)
    return driver


tefas_data_fetcher.setup_webdriver = setup_local_webdriver


def num(v, default=0.0):
    if v is None or (isinstance(v, float) and (math.isnan(v) or math.isinf(v))):
        return default
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        try:
            x = float(v)
            if math.isnan(x) or math.isinf(x):
                return default
            return x
        except (TypeError, ValueError):
            return default
    if isinstance(v, str):
        t = v.strip().replace("%", "").replace(" ", "").replace("\u00a0", "")
        if not t or t.lower() in ("-", "—", "nan"):
            return default
        # TR: 1.234,56 → 1234.56 ; 12,3456 → 12.3456
        if "," in t:
            if "." in t and t.rfind(",") > t.rfind("."):
                t = t.replace(".", "").replace(",", ".")
            else:
                t = t.replace(",", ".")
        elif t.count(".") > 1:
            t = t.replace(".", "")
        try:
            x = float(t)
            if math.isnan(x) or math.isinf(x):
                return default
            return x
        except ValueError:
            return default
    try:
        x = float(v)
        if math.isnan(x) or math.isinf(x):
            return default
        return x
    except (TypeError, ValueError):
        return default


def inte(v, default=0):
    if v is None or (isinstance(v, float) and (math.isnan(v) or math.isinf(v))):
        return default
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return default


def col(row: dict, *names: str):
    """TEFAS sütunları (eski büyük harf / yeni başlıklı) için geriye dönük okuma."""
    for n in names:
        for k, v in row.items():
            if str(k).strip().upper().replace("İ", "I") == n.upper().replace("İ", "I"):
                return v
            if str(k).strip() == n:
                return v
    keys_norm = {
        "".join(c for c in str(k).upper() if str(c).isalnum()): v for k, v in row.items()
    }
    for n in names:
        nn = "".join(c for c in n.upper() if c.isalnum())
        if nn in keys_norm:
            return keys_norm[nn]
    return None


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--fund-type", type=int, default=0, choices=[0, 1, 2, 3, 4])
    p.add_argument(
        "--tab",
        type=int,
        default=0,
        choices=[0, 1],
        help="0=genel bilgi (fon kodu/fiyat), 1=portföy dağılımı",
    )
    p.add_argument("--date", type=str, default=None, help="dd.mm.yyyy (varsayılan: bugün TR)")
    p.add_argument("--from-date", type=str, default=None, help="dd.mm.yyyy")
    p.add_argument("--to-date", type=str, default=None, help="dd.mm.yyyy")
    p.add_argument("--wait", type=int, default=3, help="Selenium bekleme (sn)")
    p.add_argument("--no-headless", action="store_true", help="Tarayıcıyı göster")
    args = p.parse_args()

    def try_fetch(from_date: str, to_date: str):
        _capture = io.StringIO()
        with contextlib.redirect_stdout(_capture):
            return fetch_tefas_data(
                args.fund_type,
                args.tab,
                from_date,
                to_date,
                headless=not args.no_headless,
                wait_seconds=max(1, args.wait),
            )

    def normalize_date_value(v) -> str:
        if v is None:
            return ""
        if isinstance(v, datetime):
            return v.strftime("%d.%m.%Y")
        if hasattr(v, "strftime"):
            try:
                return v.strftime("%d.%m.%Y")
            except Exception:
                pass
        if isinstance(v, str):
            t = v.strip()
            if not t:
                return ""
            for fmt in ("%d.%m.%Y", "%Y-%m-%d", "%Y-%m-%d %H:%M:%S", "%d/%m/%Y"):
                try:
                    return datetime.strptime(t[:19], fmt).strftime("%d.%m.%Y")
                except ValueError:
                    continue
            return t
        return str(v)

    dates_to_try: list[str] = []
    range_mode = bool(args.from_date and args.to_date)
    if range_mode:
        dates_to_try = [args.from_date.strip(), args.to_date.strip()]
    elif args.date:
        dates_to_try.append(args.date)
    else:
        # Hafta sonu / tatilde bugün boş döner; son iş günlerine geri git.
        now = datetime.now()
        for back in range(0, 14):
            d = now - timedelta(days=back)
            if d.weekday() >= 5:
                continue
            dates_to_try.append(d.strftime("%d.%m.%Y"))
            if len(dates_to_try) >= 6:
                break

    df = None
    used_date = ""
    last_err: Optional[Exception] = None
    for today in dates_to_try if not range_mode else [dates_to_try[0]]:
        try:
            if range_mode:
                df = try_fetch(dates_to_try[0], dates_to_try[1])
                used_date = dates_to_try[1]
            else:
                df = try_fetch(today, today)
                used_date = today
            if df is not None and not df.empty:
                break
        except Exception as e:
            last_err = e
            df = None
            continue

    if last_err and df is None:
        print(json.dumps({"ok": False, "error": str(last_err)}), file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        sys.exit(2)

    if df is None or df.empty:
        print(
            json.dumps(
                {
                    "ok": True,
                    "empty": True,
                    "date": dates_to_try[1] if range_mode and len(dates_to_try) > 1 else (dates_to_try[0] if dates_to_try else ""),
                    "fromDate": dates_to_try[0] if range_mode and dates_to_try else None,
                    "toDate": dates_to_try[1] if range_mode and len(dates_to_try) > 1 else None,
                    "fundTypeCode": args.fund_type,
                }
            )
        )
        sys.exit(0)

    rows = []
    for _, raw in df.iterrows():
        row = raw.to_dict()
        code = str(col(row, "FONKODU", "FON KODU", "Fon Kodu") or "").strip().upper()
        if not code:
            continue
        name = str(col(row, "FONADI", "FON ADI", "Fon Adı") or code).strip()
        prev_price = num(
            col(
                row,
                "ONCEKI_FIYAT",
                "ONCEKIFIYAT",
                "Önceki Fiyat",
                "Önceki Fiyat (TL)",
                "Onceki Fiyat",
                "Önceki Birim Fiyat",
                "Onceki Birim Fiyat",
                "Birim Payının Alış Fiyatı (TL)",
            ),
            0,
        )
        price = num(
            col(
                row,
                "FIYAT",
                "Fiyat",
                "FİYAT",
                "Fiyat (TL)",
                "Son Birim Fiyat",
                "Birim Pay Satış Fiyatı (TL)",
            ),
            0,
        )
        daily_api = num(
            col(
                row,
                "GUNLUKGETIRI",
                "GUNLUK_GETIRI",
                "Günlük Getiri (%)",
                "Günlük Getiri",
                "Gunluk Getiri",
                "Günlük Getiri Oranı (%)",
            ),
            0,
        )
        rows.append(
            {
                "date": normalize_date_value(col(row, "TARIH", "TARİH", "Tarih", "DATE", "Date")) or used_date,
                "code": code,
                "name": name,
                "shortName": code,
                "lastPrice": price,
                "previousPrice": prev_price if prev_price > 0 else 0,
                "dailyReturn": daily_api,
                "portfolioSize": num(col(row, "PORTFOYBUYUKLUGU", "PORTFOY_BUYUKLUGU", "Fon Toplam Değer"), 0),
                "investorCount": inte(col(row, "YATIRIMCISAYISI", "YATIRIMCI_SAYISI", "Kişi Sayısı"), 0),
                "shareCount": num(col(row, "TEDPAYSAYISI", "TED_PAY_SAYISI", "Tedavüldeki Pay Sayısı"), 0),
            }
        )

    print(
        json.dumps(
            {
                "ok": True,
                "empty": False,
                "date": used_date,
                "fromDate": dates_to_try[0] if range_mode and dates_to_try else None,
                "toDate": dates_to_try[1] if range_mode and len(dates_to_try) > 1 else None,
                "fundTypeCode": args.fund_type,
                "rows": rows,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
