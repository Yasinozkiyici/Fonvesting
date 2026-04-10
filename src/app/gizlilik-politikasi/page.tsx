import type { Metadata } from "next";
import { StaticPageShell } from "@/components/StaticPageShell";
import {
  gizlilikPolitikasiPage,
  sorumlulukReddiPage,
  kullanimKosullariPage,
} from "@/content/static-pages";

export const revalidate = 86_400;

export const metadata: Metadata = {
  title: gizlilikPolitikasiPage.metaTitle,
  description: gizlilikPolitikasiPage.metaDescription,
};

export default function GizlilikPolitikasiPage() {
  return (
    <StaticPageShell
      page={gizlilikPolitikasiPage}
      relatedLinks={[
        { href: sorumlulukReddiPage.path, label: "Sorumluluk Reddi" },
        { href: kullanimKosullariPage.path, label: "Kullanım Koşulları" },
      ]}
    />
  );
}
