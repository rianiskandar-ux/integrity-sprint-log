import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  experimental: {
    serverActions: {
      allowedOrigins: ['daily-sprint.test', 'localhost:3000'],
    },
  },
};

export default nextConfig;
