import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "25mb",
    },
  },
  // Photo/scan frames are served through the auth-gated /api/files route,
  // never from a public bucket.
  images: { unoptimized: true },
};

export default nextConfig;
