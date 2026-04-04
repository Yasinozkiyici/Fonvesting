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
import sys
import traceback
from datetime import datetime

try:
    from tefasfon import fetch_tefas_data
except ImportError:
    print(
        json.dumps({"ok": False, "error": "tefasfon yok. pip install -r scripts/requirements.txt"}),
        file=sys.stderr,
    )
    sys.exit(2)


def num(v, default=0.0):
    if v is None or (isinstance(v, float) and (math.isnan(v) or math.isinf(v))):
        return default
    try:
        return float(v)
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
    p.add_argument("--wait", type=int, default=3, help="Selenium bekleme (sn)")
    p.add_argument("--no-headless", action="store_true", help="Tarayıcıyı göster")
    args = p.parse_args()

    today = args.date or datetime.now().strftime("%d.%m.%Y")

    try:
        # tefasfon Rich çıktısı stdout'u kirletir; JSON stdout'a tek satır yazılır.
        _capture = io.StringIO()
        with contextlib.redirect_stdout(_capture):
            df = fetch_tefas_data(
                args.fund_type,
                args.tab,
                today,
                today,
                headless=not args.no_headless,
                wait_seconds=max(1, args.wait),
            )
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}), file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        sys.exit(2)

    if df is None or df.empty:
        print(json.dumps({"ok": True, "empty": True, "date": today, "fundTypeCode": args.fund_type}))
        sys.exit(0)

    rows = []
    for _, raw in df.iterrows():
        row = raw.to_dict()
        code = str(col(row, "FONKODU", "FON KODU", "Fon Kodu") or "").strip().upper()
        if not code:
            continue
        name = str(col(row, "FONADI", "FON ADI", "Fon Adı") or code).strip()
        prev_price = num(col(row, "ONCEKI_FIYAT", "ONCEKIFIYAT"), 0)
        price = num(col(row, "FIYAT", "Fiyat"), 0)
        daily_api = num(col(row, "GUNLUKGETIRI", "GUNLUK_GETIRI", "Günlük Getiri (%)", "Günlük Getiri"), 0)
        rows.append(
            {
                "code": code,
                "name": name,
                "shortName": code,
                "lastPrice": price,
                "previousPrice": prev_price if prev_price else price,
                "dailyReturn": daily_api,
                "portfolioSize": num(col(row, "PORTFOYBUYUKLUGU", "PORTFOY_BUYUKLUGU", "Fon Toplam Değer"), 0),
                "investorCount": inte(col(row, "YATIRIMCISAYISI", "YATIRIMCI_SAYISI", "Kişi Sayısı"), 0),
                "shareCount": num(col(row, "TEDPAYSAYISI", "TED_PAY_SAYISI", "Tedavüldeki Pay Sayısı"), 0),
            }
        )

    print(
        json.dumps(
            {"ok": True, "empty": False, "date": today, "fundTypeCode": args.fund_type, "rows": rows},
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
