/**
 * TEFAS oturum tarihi: sunucu saat diliminden bağımsız UTC gün anahtarı.
 * (Hafta sonu / iş günü farkı senkron ve TEFAS satır verisinde çözülür.)
 */

/** TEFAS gg.aa.yyyy → o günün UTC 00:00 anı (DB tarih anahtarı) */
export function parseTefasSessionDate(ddMmYyyy: string): Date | null {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(ddMmYyyy.trim());
  if (!m || m[1] === undefined || m[2] === undefined || m[3] === undefined) return null;
  const day = parseInt(m[1], 10);
  const month = parseInt(m[2], 10) - 1;
  const year = parseInt(m[3], 10);
  const t = Date.UTC(year, month, day, 0, 0, 0, 0);
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}
