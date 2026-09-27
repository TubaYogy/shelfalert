import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // We run a custom server (server.ts) so we do NOT use `output: "standalone"`.
  reactStrictMode: true,
  poweredByHeader: false,
  eslint: {
    // Linting is run separately; do not fail the production build on lint.
    ignoreDuringBuilds: true,
  },
  images: {
    // Book cover thumbnails come from Google Books / Open Library CDNs.
    remotePatterns: [
      { protocol: "https", hostname: "books.google.com" },
      { protocol: "http", hostname: "books.google.com" },
      { protocol: "https", hostname: "covers.openlibrary.org" },
      { protocol: "https", hostname: "*.googleusercontent.com" },
    ],
  },
};

export default nextConfig;
