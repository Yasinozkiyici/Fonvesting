import type { Metadata } from "next";
import { StaticPageShell } from "@/components/StaticPageShell";
import { iletisimPage, hakkimizdaPage, vizyonumuzPage } from "@/content/static-pages";

export const revalidate = 86_400;

export const metadata: Metadata = {
  title: iletisimPage.metaTitle,
  description: iletisimPage.metaDescription,
};

export default function IletisimPage() {
  return (
    <StaticPageShell
      page={iletisimPage}
      relatedLinks={[
        { href: hakkimizdaPage.path, label: "Hakkımızda" },
        { href: vizyonumuzPage.path, label: "Vizyonumuz" },
      ]}
    />
  );
}
