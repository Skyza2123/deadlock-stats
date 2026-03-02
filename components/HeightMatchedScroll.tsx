"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

type HeightMatchedScrollProps = {
  targetId: string;
  className?: string;
  minHeight?: number;
  children: ReactNode;
};

export default function HeightMatchedScroll({
  targetId,
  className,
  minHeight = 280,
  children,
}: HeightMatchedScrollProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [maxHeight, setMaxHeight] = useState<number | null>(null);

  useEffect(() => {
    const target = document.getElementById(targetId);
    const container = containerRef.current;
    if (!target || !container) {
      setMaxHeight(null);
      return;
    }

    const update = () => {
      const targetRect = target.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();

      const targetBottomAbs = Math.round(targetRect.bottom + window.scrollY);
      const containerTopAbs = Math.round(containerRect.top + window.scrollY);
      const measured = targetBottomAbs - containerTopAbs;

      setMaxHeight(Math.max(minHeight, measured));
    };

    update();

    const observer = new ResizeObserver(update);
    observer.observe(target);
    window.addEventListener("resize", update);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [targetId, minHeight]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={maxHeight != null ? { maxHeight: `${maxHeight}px`, overflowY: "auto" } : undefined}
    >
      {children}
    </div>
  );
}
