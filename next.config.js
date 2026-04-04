/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Next 14.2: Prisma'yı App Router sunucu paketinden dışarı tut (delegate / bağlantı sorunlarını önler).
  experimental: {
    serverComponentsExternalPackages: ["@prisma/client", ".prisma/client"],
  },
};

module.exports = nextConfig;
