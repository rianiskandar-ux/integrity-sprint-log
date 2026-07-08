import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  // Doc Parser (app/api/docs/upload): pdf-parse pulls in pdfjs-dist + the
  // native @napi-rs/canvas binary, and mammoth ships its own WASM — neither
  // bundles cleanly. Keep them as real node_modules requires so the
  // standalone output copies (and file-traces) them as-is.
  serverExternalPackages: ['pdf-parse', 'mammoth'],
  experimental: {
    serverActions: {
      allowedOrigins: ['daily-sprint.test', 'localhost:3000'],
    },
  },
};

export default nextConfig;
