"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Search, Menu, X, Sun, Moon } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import { SiteLogoLink } from "@/components/SiteLogo";

export default function Header() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const pathname = usePathname();

  const navLinks = [
    { href: "/", label: "Piyasalar" },
    { href: "/stocks", label: "Fonlar" },
    { href: "/sectors", label: "Kategoriler" },
    { href: "/indices", label: "Fon türleri" },
  ];

  return (
    <header
      className="sticky top-0 z-50 border-b"
      style={{
        background: "var(--nav-bg)",
        borderColor: "var(--nav-border)",
      }}
    >
      <div className="mx-auto max-w-[1320px] px-3 pt-[env(safe-area-inset-top,0px)] sm:px-6 lg:px-8">
        <div className="flex h-[3.375rem] items-stretch gap-0 sm:h-[3.5rem] sm:gap-1 md:items-center md:gap-0">
          <div className="header-brand flex min-w-0 shrink-0 items-center">
            <SiteLogoLink />
          </div>

          <nav
            className="header-primary-nav hidden min-w-0 flex-1 items-center justify-center md:flex"
            aria-label="Ana menü"
          >
            <div className="header-nav-inner">
              {navLinks.map((link) => {
                const isActive = pathname === link.href;
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`nav-link nav-link--bar ${isActive ? "active" : ""}`}
                    aria-current={isActive ? "page" : undefined}
                  >
                    {link.label}
                  </Link>
                );
              })}
            </div>
          </nav>

          <div className="flex min-w-0 flex-1 items-center justify-end gap-2 md:flex-initial md:pl-3">
            <div className="header-tools hidden sm:inline-flex">
              <div className="header-tools__search">
                <Search
                  className="pointer-events-none absolute left-2.5 top-1/2 h-[14px] w-[14px] -translate-y-1/2 opacity-[0.78]"
                  style={{ color: "var(--text-tertiary)" }}
                  strokeWidth={2}
                  aria-hidden
                />
                <input
                  type="search"
                  placeholder="Fon ara…"
                  className="header-search-input max-w-full"
                  autoComplete="off"
                  aria-label="Fon ara"
                />
              </div>
              <span className="header-tools__rule header-tools__rule--sm" aria-hidden />
              <button
                type="button"
                onClick={toggleTheme}
                className="header-tools__btn"
                aria-label={theme === "light" ? "Karanlık temaya geç" : "Aydınlık temaya geç"}
              >
                {theme === "light" ? (
                  <Moon className="h-[14px] w-[14px]" strokeWidth={2} />
                ) : (
                  <Sun className="h-[14px] w-[14px]" strokeWidth={2} />
                )}
              </button>
            </div>

            <div className="header-mobile-cluster md:hidden">
              <button
                type="button"
                onClick={toggleTheme}
                className="header-mobile-cluster__btn"
                aria-label={theme === "light" ? "Karanlık temaya geç" : "Aydınlık temaya geç"}
              >
                {theme === "light" ? (
                  <Moon className="h-[14px] w-[14px]" strokeWidth={2} />
                ) : (
                  <Sun className="h-[14px] w-[14px]" strokeWidth={2} />
                )}
              </button>
              <span className="header-mobile-cluster__rule" aria-hidden />
              <button
                type="button"
                onClick={() => setIsMenuOpen(!isMenuOpen)}
                className="header-mobile-cluster__btn"
                aria-expanded={isMenuOpen}
                aria-label={isMenuOpen ? "Menüyü kapat" : "Menüyü aç"}
              >
                {isMenuOpen ? <X className="h-[14px] w-[14px]" strokeWidth={2} /> : <Menu className="h-[14px] w-[14px]" strokeWidth={2} />}
              </button>
            </div>
          </div>
        </div>

        {isMenuOpen && (
          <div className="border-t py-3 md:hidden" style={{ borderColor: "var(--border-subtle)" }}>
            <div className="relative mb-3">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2"
                style={{ color: "var(--text-muted)" }}
                strokeWidth={2}
                aria-hidden
              />
              <input
                type="search"
                placeholder="Fon ara…"
                className="header-drawer-search w-full pl-10"
                autoComplete="off"
                aria-label="Fon ara"
              />
            </div>
            <nav className="flex flex-col gap-px" aria-label="Mobil menü">
              {navLinks.map((link) => {
                const isActive = pathname === link.href;
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setIsMenuOpen(false)}
                    className={`nav-link nav-link--mobile ${isActive ? "active" : ""}`}
                    aria-current={isActive ? "page" : undefined}
                  >
                    {link.label}
                  </Link>
                );
              })}
            </nav>
          </div>
        )}
      </div>
    </header>
  );
}
