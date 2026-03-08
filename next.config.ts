import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/hero-images/**": ["./deadlock_hero_images/**/*"],
    "/api/hero-images/[heroFolder]/[fileName]": ["./deadlock_hero_images/**/*"],
    "/api/hero-images/[heroFolder]/[fileName]/route": ["./deadlock_hero_images/**/*"],
    "/api/item-icons/**": ["./deadlock_icons/**/*"],
    "/api/item-icons/[fileName]": ["./deadlock_icons/**/*"],
    "/api/item-icons/[fileName]/route": ["./deadlock_icons/**/*"],
  },
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
