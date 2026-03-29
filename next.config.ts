import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  outputFileTracingIncludes: {
    "/api/item-icons/**": ["./deadlock_icons/**/*"],
    "/api/item-icons/[fileName]": ["./deadlock_icons/**/*"],
    "/api/item-icons/[fileName]/route": ["./deadlock_icons/**/*"],
    "/api/hero-images/[heroFolder]/render": ["./deadlock_hero_images/**/*_Render.png"],
  },
  outputFileTracingExcludes: {
    "*": [
      "./deadlock_hero_images/**/*.webp",
      "./deadlock_hero_images/**/background_image.png",
      "./deadlock_hero_images/**/hero_card_*.png",
      "./deadlock_hero_images/**/icon_hero_card.png",
      "./deadlock_hero_images/**/icon_image_small.png",
      "./deadlock_hero_images/**/minimap_image.png",
      "./deadlock_hero_images/**/top_bar_vertical_image.png",
      "./deadlock_hero_images/**/name_image",
      "./deadlock_icons/**/*",
      "./hero_portraits/**/*",
      "./reports/**/*",
    ],
  },
};

export default nextConfig;
