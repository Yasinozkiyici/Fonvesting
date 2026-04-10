import type { Metadata } from "next";
import { StaticPageShell } from "@/components/StaticPageShell";
import { vizyonumuzPage, hakkimizdaPage, iletisimPage } from "@/content/static-pages";

export const revalidate = 86_400;

export const metadata: Metadata = {
  title: vizyonumuzPage.metaTitle,
  description: vizyonumuzPage.metaDescription,
};

export default function VizyonumuzPage() {
  return (
    <StaticPageShell
      page={vizyonumuzPage}
      relatedLinks={[
        { href: hakkimizdaPage.path, label: "Hakkımızda" },
        { href: iletisimPage.path, label: "İletişim" },
      ]}
    />
  );
}
