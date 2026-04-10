import type { Metadata } from "next";
import { TrustPageShell } from "@/components/trust/TrustPageShell";
import { dataSourcesPage } from "@/content/trust-pages";

export const revalidate = 86_400;

export const metadata: Metadata = {
  title: dataSourcesPage.metaTitle,
  description: dataSourcesPage.metaDescription,
};

export default function VeriKaynaklariPage() {
  return (
    <TrustPageShell
      currentPath={dataSourcesPage.path}
      kicker={dataSourcesPage.kicker}
      title={dataSourcesPage.title}
      sections={dataSourcesPage.sections}
    />
  );
}
