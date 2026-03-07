import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingExcludes: {
    "*": [
      "./reports/**/*",
    ],
  },
};

export default nextConfig;
