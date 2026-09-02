import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  images: {
    unoptimized: true
  },
  turbopack: {
    root: fileURLToPath(new URL("../..", import.meta.url))
  }
};

export default nextConfig;
