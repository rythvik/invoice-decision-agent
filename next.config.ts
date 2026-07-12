import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  devIndicators: false, // hide Next.js's dev overlay button (dev only anyway)
};

export default nextConfig;
