import Link from "next/link";

type Props = { params: { code: string } };

/** MVP: detay sayfası iskeleti — ileride metrikler ve grafikler buraya taşınacak. */
export default function FundDetailPage({ params }: Props) {
  const code = decodeURIComponent(params.code ?? "").trim() || "—";
  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <p className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>
        Fon detayı
      </p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight" style={{ color: "var(--text-primary)" }}>
        {code}
      </h1>
      <p className="mt-3 text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
        Bu sayfa yakında genişletilecek: performans geçmişi, risk özeti ve karşılaştırma.
      </p>
      <Link
        href="/"
        className="mt-8 inline-flex text-sm font-semibold transition-opacity hover:opacity-80"
        style={{ color: "var(--accent)" }}
      >
        ← Fon sıralamasına dön
      </Link>
    </div>
  );
}
