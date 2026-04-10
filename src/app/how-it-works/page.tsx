import Link from "next/link";
import Header from "@/components/Header";
import { SitePageShell } from "@/components/SitePageShell";
import Footer from "@/components/tefas/Footer";

export const revalidate = 86_400;

export default function HowItWorksPage() {
  return (
    <SitePageShell>
        <Header />

        <main className="mx-auto w-full max-w-[720px] flex-1 px-4 py-10 sm:px-6 lg:px-8">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--text-muted)" }}>
            Güven
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-[1.65rem]" style={{ color: "var(--text-primary)" }}>
            Yatirim.io fon verisini nasıl sunar?
          </h1>
          <div className="mt-6 space-y-5 text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
            <p>
              Yatirim.io,{" "}
              <a
                href="https://www.fundturkiye.gov.tr"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium underline-offset-2 hover:underline"
                style={{ color: "var(--text-primary)" }}
              >
                resmi fon verisi
              </a>{" "}
              üzerinden yatırım fonlarını daha hızlı araştırma için düzenler: sıralamalar, filtreler ve profiller bilinçli
              olarak sade tutulur.
            </p>
            <p>
              Sıralamalar; getiri, hacim, ölçek ve modelden türeyen risk sinyalleri gibi ölçülebilir alanları dengeli,
              büyüme veya daha düşük dalgalanma gibi modlarda bir araya getirir. Bunlar kendi ön araştırmanız için bir
              başlangıçtır; al/sat tavsiyesi değildir.
            </p>
            <p>
              Resmi akışlardan planlı senkron ile yenileriz. Bir rakam şüpheli görünürse fonun resmi sayfasına ve aracı
              kurumunuza bakın — piyasalar hareket eder, kesim saatleri farklıdır.
            </p>
          </div>
          <p className="mt-8 text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
            Soru için:{" "}
            <a href="mailto:hello@yatirim.io" className="underline-offset-2 hover:underline" style={{ color: "var(--text-secondary)" }}>
              hello@yatirim.io
            </a>
            {" · "}
            <Link href="/status" prefetch={false} className="underline-offset-2 hover:underline" style={{ color: "var(--text-secondary)" }}>
              Sistem durumu
            </Link>
            {" · "}
            <Link href="/metodoloji" prefetch={false} className="underline-offset-2 hover:underline" style={{ color: "var(--text-secondary)" }}>
              Metodoloji
            </Link>
            {" · "}
            <Link href="/veri-kaynaklari" prefetch={false} className="underline-offset-2 hover:underline" style={{ color: "var(--text-secondary)" }}>
              Yöntem ve veri
            </Link>
            {" · "}
            <Link href="/sorumluluk-reddi" prefetch={false} className="underline-offset-2 hover:underline" style={{ color: "var(--text-secondary)" }}>
              Sorumluluk reddi
            </Link>
          </p>
        </main>

        <Footer />
    </SitePageShell>
  );
}
