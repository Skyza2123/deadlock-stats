import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/hero-images/[heroFolder]/[fileName]": ["./deadlock_hero_images/**/*"],
    "/api/item-icons/[fileName]": ["./deadlock_icons/**/*"],
  },
  outputFileTracingExcludes: {
    "/*": [
      "./deadlock_hero_images/**/*",
      "./deadlock_icons/**/*",
      "./hero_portraits/**/*",
      "./reports/**/*",
    ],
  },
};

export default nextConfig;
