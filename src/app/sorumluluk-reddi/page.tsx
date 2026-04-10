import type { Metadata } from "next";
import { StaticPageShell } from "@/components/StaticPageShell";
import {
  sorumlulukReddiPage,
  gizlilikPolitikasiPage,
  kullanimKosullariPage,
} from "@/content/static-pages";

export const revalidate = 86_400;

export const metadata: Metadata = {
  title: sorumlulukReddiPage.metaTitle,
  description: sorumlulukReddiPage.metaDescription,
};

export default function SorumlulukReddiPage() {
  return (
    <StaticPageShell
      page={sorumlulukReddiPage}
      relatedLinks={[
        { href: gizlilikPolitikasiPage.path, label: "Gizlilik Politikası" },
        { href: kullanimKosullariPage.path, label: "Kullanım Koşulları" },
      ]}
    />
  );
}
