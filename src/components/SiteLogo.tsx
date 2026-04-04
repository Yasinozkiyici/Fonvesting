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
      className={`site-logo-link group flex flex-shrink-0 items-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--nav-bg)] ${className}`.trim()}
      aria-label="Yatirim.io — ana sayfa"
    >
      <SiteLogo size={size} />
    </Link>
  );
}
