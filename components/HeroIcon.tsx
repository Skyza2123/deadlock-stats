"use client";

import { useState } from "react";

type HeroIconProps = {
  src: string | null;
  alt: string;
  width: number;
  height: number;
  className?: string;
};

export default function HeroIcon({ src, alt, width, height, className }: HeroIconProps) {
  const [hidden, setHidden] = useState(false);

  if (!src || hidden) return null;

  return (
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      className={className}
      onError={() => setHidden(true)}
    />
  );
}
