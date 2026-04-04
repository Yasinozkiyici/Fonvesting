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
      className="sticky top-0 z-50 border-b backdrop-blur-xl transition-colors"
      style={{
        background: 'var(--nav-bg)',
        borderColor: 'var(--nav-border)',
      }}
    >
      <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <SiteLogoLink />

          {/* Navigation - Desktop */}
          <nav className="hidden md:flex items-center gap-1">
            {navLinks.map((link) => {
              const isActive = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`nav-link ${isActive ? 'active' : ''}`}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>

          {/* Right Section */}
          <div className="flex items-center gap-2">
            {/* Search */}
            <div className="relative hidden sm:block group">
              <Search 
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 transition-colors"
                style={{ color: 'var(--text-muted)' }}
              />
              <input
                type="text"
                placeholder="Fon ara..."
                className="w-48 h-9 pl-9 pr-3 text-sm rounded-lg transition-all focus:w-64"
                style={{
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-default)',
                  color: 'var(--text-primary)',
                }}
              />
            </div>

            {/* Theme Toggle */}
            <button
              onClick={toggleTheme}
              className="theme-toggle"
              aria-label={theme === 'light' ? 'Karanlık temaya geç' : 'Aydınlık temaya geç'}
            >
              {theme === 'light' ? (
                <Moon className="w-4 h-4" />
              ) : (
                <Sun className="w-4 h-4" />
              )}
            </button>

            {/* Mobile Menu Toggle */}
            <button
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className="md:hidden theme-toggle"
            >
              {isMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Mobile Menu */}
        {isMenuOpen && (
          <div 
            className="md:hidden py-4 border-t"
            style={{ borderColor: 'var(--border-subtle)' }}
          >
            <div className="relative mb-3">
              <Search 
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
                style={{ color: 'var(--text-muted)' }}
              />
              <input
                type="text"
                placeholder="Fon ara..."
                className="input pl-10"
              />
            </div>
            <nav className="flex flex-col gap-1">
              {navLinks.map((link) => {
                const isActive = pathname === link.href;
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setIsMenuOpen(false)}
                    className={`nav-link ${isActive ? 'active' : ''}`}
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
