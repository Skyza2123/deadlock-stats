"use client";

import { usePathname } from "next/navigation";
import { useRouter } from "next/navigation";

type BackButtonProps = {
  fallbackHref?: string;
};

function sameOriginReferrerPath(currentPathname: string) {
  if (typeof window === "undefined") return null;
  if (!document.referrer) return null;

  try {
    const referrerUrl = new URL(document.referrer);
    if (referrerUrl.origin !== window.location.origin) return null;

    const refPath = `${referrerUrl.pathname}${referrerUrl.search}${referrerUrl.hash}`;
    if (!refPath || refPath === currentPathname) return null;
    if (referrerUrl.pathname.startsWith("/api/")) return null;

    return refPath;
  } catch {
    return null;
  }
}

function inferFallback(pathname: string, explicitFallback?: string) {
  if (explicitFallback) return explicitFallback;
  if (pathname.startsWith("/match/")) return "/scrims";
  return "/";
}

export default function BackButton({ fallbackHref }: BackButtonProps) {
  const router = useRouter();
  const pathname = usePathname();

  function handleBack() {
    const referrerPath = sameOriginReferrerPath(pathname);
    const fallback = inferFallback(pathname, fallbackHref);

    if (window.history.length > 1) {
      router.back();
      return;
    }

    if (referrerPath) {
      router.push(referrerPath);
      return;
    }

    router.push(fallback);
  }

  return (
    <button
      onClick={handleBack}
      className="rounded border border-zinc-700/80 bg-zinc-900/80 px-4 py-2 text-sm text-zinc-100 hover:bg-zinc-800/90"
    >
      ← Back
    </button>
  );
}