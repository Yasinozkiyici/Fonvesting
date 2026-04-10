import type { Metadata } from "next";
import { TrustPageShell } from "@/components/trust/TrustPageShell";
import { methodologyPage } from "@/content/trust-pages";

export const revalidate = 86_400;

export const metadata: Metadata = {
  title: methodologyPage.metaTitle,
  description: methodologyPage.metaDescription,
};

export default function MetodolojiPage() {
  return (
    <TrustPageShell
      currentPath={methodologyPage.path}
      kicker={methodologyPage.kicker}
      title={methodologyPage.title}
      sections={methodologyPage.sections}
    />
  );
}
