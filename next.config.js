/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Next 14.2: Prisma'yı App Router sunucu paketinden dışarı tut (delegate / bağlantı sorunlarını önler).
  experimental: {
    serverComponentsExternalPackages: ["@prisma/client", ".prisma/client"],
  },
  // macOS / APFS: dev sırasında webpack pack önbellek rename (ENOENT) ve ardından 500 / bozuk _next istekleri görülebiliyor.
  webpack: (config, { dev }) => {
    if (dev) {
      config.cache = false;
    }
    return config;
  },
};

module.exports = nextConfig;
