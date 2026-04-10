import type { Metadata } from "next";
import { StaticPageShell } from "@/components/StaticPageShell";
import {
  kullanimKosullariPage,
  sorumlulukReddiPage,
  gizlilikPolitikasiPage,
} from "@/content/static-pages";

export const revalidate = 86_400;

export const metadata: Metadata = {
  title: kullanimKosullariPage.metaTitle,
  description: kullanimKosullariPage.metaDescription,
};

export default function KullanimKosullariPage() {
  return (
    <StaticPageShell
      page={kullanimKosullariPage}
      relatedLinks={[
        { href: sorumlulukReddiPage.path, label: "Sorumluluk Reddi" },
        { href: gizlilikPolitikasiPage.path, label: "Gizlilik Politikası" },
      ]}
    />
  );
}
