import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  turbopack: {
    root: new URL("../..", import.meta.url).pathname
  }
};

export default nextConfig;
