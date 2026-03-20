import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Sidebar from "../components/Sidebar";
import ThemeInitializer from "../components/ThemeInitializer";
import AuthSessionProvider from "../components/AuthSessionProvider";
import { ReactNode } from "react";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Deadlock Stats",
  description: "Scrim analytics dashboard",
  viewport: "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no",
};

function LayoutContent({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen w-full flex-col md:flex-row">
      <Sidebar />
      <div className="flex min-h-screen w-full flex-1 min-w-0 flex-col border-zinc-900/55 bg-zinc-950/25 pb-16 md:border-l md:pb-0">
        <div className="w-full flex-1">{children}</div>
        <Footer />
      </div>
    </div>
  );
}

function Footer() {
  const year = new Date().getFullYear();
  
  return (
    <footer className="border-t border-zinc-800/70 px-4 py-3 text-xs text-zinc-400 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Link href="/privacy" className="hover:text-zinc-200 hover:underline">
            Privacy Policy
          </Link>
          <span aria-hidden>•</span>
          <Link href="/terms" className="hover:text-zinc-200 hover:underline">
            Terms
          </Link>
        </div>
        <p>© {year} Deadlock Stats. All rights reserved.</p>
      </div>
    </footer>
  );
}

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased site-readable`}
      >
        <AuthSessionProvider>
          <ThemeInitializer />
          <LayoutContent>{children}</LayoutContent>
        </AuthSessionProvider>
      </body>
    </html>
  );
}