# Yatirim.io Geliştirme Kuralları

Bu repo için geçerli guardrail dosyaları insanlar, Codex ve Cursor dahil tüm geliştirici araçları için tek kaynak kabul edilir.

İlk okunacak dosyalar:
- `AGENTS.md`
- `docs/architecture-rules.md`
- `docs/ui-guardrails.md`
- `docs/data-flow-rules.md`
- `docs/performance-rules.md`
- `docs/release-checklist.md`

Temel doğrulama komutları:
- `pnpm run prod:check`
- `pnpm exec tsc --noEmit`
- `pnpm run test:unit`
- `pnpm run smoke:routes`
- `pnpm run smoke:data`

Beklenen çalışma sırası:
1. Önce mevcut route/data akışını incele.
2. Davranışı değiştirmeden minimum güvenli değişikliği yap.
3. Mobil ve desktop etkisini birlikte düşün.
4. Typecheck ve en az bir smoke kontrolü çalıştır.
5. Guardrail dokümanlarıyla çelişen değişiklik yapma.
