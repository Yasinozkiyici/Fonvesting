import os
import sys
import traceback
from datetime import datetime, time

import pytz
import yfinance as yf
from supabase import create_client


def is_borsa_acik(now_utc3: datetime) -> bool:
    """Türkiye saati (UTC+3) ile borsa çalışma saatini kontrol eder."""
    current = now_utc3.time()
    start = time(9, 0)
    end = time(18, 30)  # 18:30 dahil, 18:30'dan sonra kapalı kabul edilir.
    return (current >= start) and (current <= end)


def parse_symbols() -> list[str]:
    symbols_raw = os.environ.get("SYMBOLS", "THYAO.IS,ASELS.IS")
    symbols = [s.strip().upper() for s in symbols_raw.split(",") if s.strip()]
    if not symbols:
        raise ValueError("SYMBOLS boş olamaz. Örn: SYMBOLS='THYAO.IS,ASELS.IS'")
    return symbols


def iso_timestamp(dt) -> str:
    # yfinance index bazen tz bilgisi taşır.
    if hasattr(dt, "tzinfo") and dt.tzinfo is not None:
        return dt.isoformat()
    return str(dt)


def fetch_latest_ohlcv(symbol: str) -> dict:
    # Saatlik cron çalıştığı için 1 saatlik interval ile son kaydı alıyoruz.
    df = yf.download(
        symbol,
        period="2d",
        interval="1h",
        progress=False,
        threads=False,
    )
    if df is None or df.empty:
        raise ValueError(f"yfinance boş veri döndü: {symbol}")

    last_ts = df.index[-1]
    last = df.iloc[-1]

    # yfinance tek sembol için kolonlar genelde: Open/High/Low/Close/Volume
    vol = None if "Volume" not in df.columns else last["Volume"]
    vol_int = None
    if vol is not None and vol == vol:  # NaN kontrolü
        try:
            vol_int = int(vol)
        except (TypeError, ValueError):
            vol_int = None

    return {
        "symbol": symbol,
        "timestamp": iso_timestamp(last_ts),
        "open": None if "Open" not in df.columns else float(last["Open"]),
        "high": None if "High" not in df.columns else float(last["High"]),
        "low": None if "Low" not in df.columns else float(last["Low"]),
        "close": None if "Close" not in df.columns else float(last["Close"]),
        "volume": vol_int,
    }


def main() -> None:
    try:
        # 1) Script açılır açılmaz Türkiye saati (UTC+3) kontrolü.
        now_utc3 = datetime.now(pytz.FixedOffset(180))
        if not is_borsa_acik(now_utc3):
            print("Borsa kapalı, işlem yapılmadı")
            return

        # 2) Supabase ayarları (güvenli şekilde environ'dan).
        supabase_url = os.environ.get("SUPABASE_URL")
        supabase_key = os.environ.get("SUPABASE_KEY")
        if not supabase_url or not supabase_key:
            raise EnvironmentError("SUPABASE_URL ve SUPABASE_KEY gerekli (GitHub Secrets).")

        table_name = os.environ.get("SUPABASE_TABLE", "TABLO_ADIN")
        on_conflict = os.environ.get("SUPABASE_ON_CONFLICT", "symbol")

        supabase = create_client(supabase_url, supabase_key)

        symbols = parse_symbols()

        updated_count = 0
        total = len(symbols)

        for symbol in symbols:
            try:
                payload = fetch_latest_ohlcv(symbol)

                # Upsert: "on_conflict" değerinin, tablondaki unique constraint / pk ile uyumlu olması gerekir.
                supabase.table(table_name).upsert([payload], on_conflict=on_conflict).execute()
                updated_count += 1
                print(f"[OK] {symbol}")
            except Exception as e:
                print(f"[HATA] {symbol}: {e}", file=sys.stderr)
                traceback.print_exc()

        print(f"Güncellenen hisse sayısı: {updated_count}/{total}")
    except Exception as e:
        print(f"[FATAL] {e}", file=sys.stderr)
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()

