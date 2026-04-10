/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
        ],
      },
    ];
  },
  experimental: {
    serverComponentsExternalPackages: [
      "@prisma/client",
      ".prisma/client",
      "@sparticuz/chromium",
      "playwright",
      "playwright-core",
    ],
  },
  // Dev’de varsayılan webpack önbelleği: HMR / CSS daha stabil. APFS’te cache rename hatası görürseniz:
  // NEXT_DISABLE_WEBPACK_CACHE=1 pnpm dev
  webpack: (config, { dev }) => {
    if (dev && process.env.NEXT_DISABLE_WEBPACK_CACHE === "1") {
      config.cache = false;
    }
    return config;
  },
};

module.exports = nextConfig;
