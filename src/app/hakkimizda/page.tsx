import type { Metadata } from "next";
import { StaticPageShell } from "@/components/StaticPageShell";
import { hakkimizdaPage, vizyonumuzPage, iletisimPage } from "@/content/static-pages";

export const revalidate = 86_400;

export const metadata: Metadata = {
  title: hakkimizdaPage.metaTitle,
  description: hakkimizdaPage.metaDescription,
};

export default function HakkimizdaPage() {
  return (
    <StaticPageShell
      page={hakkimizdaPage}
      relatedLinks={[
        { href: vizyonumuzPage.path, label: "Vizyonumuz" },
        { href: iletisimPage.path, label: "İletişim" },
      ]}
    />
  );
}
