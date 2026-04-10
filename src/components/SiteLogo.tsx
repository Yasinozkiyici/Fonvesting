import Link from "next/link";

type SiteLogoSize = "header" | "footer";

type SiteLogoProps = {
  /** Header veya footer için tipografi ölçeği */
  size?: SiteLogoSize;
  className?: string;
};

/**
 * Tek renkli wordmark: açık temada siyah, koyu temada açık gri (kontrast).
 */
export function SiteLogo({ size = "header", className = "" }: SiteLogoProps) {
  const sizeClass = size === "footer" ? "site-logo--footer" : "site-logo--header";
  return (
    <span className={`site-logo ${sizeClass} ${className}`.trim()} translate="no">
      Yatirim<span className="site-logo__tld">.io</span>
    </span>
  );
}

type SiteLogoLinkProps = {
  size?: SiteLogoSize;
  className?: string;
};

export function SiteLogoLink({ size = "header", className = "" }: SiteLogoLinkProps) {
  return (
    <Link
      href="/"
      prefetch={false}
      className={`site-logo-link group flex flex-shrink-0 items-center rounded-[6px] px-0 py-0.5 outline-none transition-[opacity,transform] duration-200 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-blue)] active:scale-[0.99] ${className}`.trim()}
      aria-label="Yatirim.io — ana sayfa"
    >
      <SiteLogo size={size} />
    </Link>
  );
}
