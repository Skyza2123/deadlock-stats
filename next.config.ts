import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingExcludes: {
    "*": [
      "./deadlock_hero_images/**/*",
      "./deadlock_icons/**/*",
      "./hero_portraits/**/*",
      "./reports/**/*",
    ],
  },
};

export default nextConfig;
