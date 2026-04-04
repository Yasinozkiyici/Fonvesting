"""
Uzak veritabanı / Supabase senkronu bu repoda kullanılmıyor.
Yeni altyapı kurulana kadar script kasıtlı olarak hiçbir yere bağlanmaz.
"""

import sys


def main() -> None:
    print("fetch_data.py: Uzak DB senkronu devre dışı (yerel SQLite / Prisma kullanın).")
    sys.exit(0)


if __name__ == "__main__":
    main()
