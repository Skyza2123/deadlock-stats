"use client";

import { useSession } from "next-auth/react";
import ScrimDashboard from "@/components/ScrimDashboard";
import DemoLanding from "@/components/DemoLanding";

export default function HomePage() {
  const { data: session, status } = useSession();

  if (status === "loading") {
    return (
      <main className="min-h-[90vh] w-full flex-col md:flex">
        <div className="shadow-sm">
          <div className="hidden min-h-16 items-center px-4 py-2 md:flex" />
        </div>
        <div className="flex-1 px-4 pb-6 pt-4 sm:px-6 lg:px-8 lg:pt-6">
          <div className="flex items-center justify-center py-12">
          <div className="text-center text-zinc-400">Loading...</div>
        </div>
        </div>
      </main>
    );
  }

  if (!session) {
    return <DemoLanding />;
  }

  return (
    <main className="min-h-[90vh] w-full flex-col md:flex">
      <div className="shadow-sm">
        <div className="flex min-h-16 items-center justify-between px-4 py-2 sm:px-6 lg:px-8">
          <h1 className="text-3xl font-bold tracking-tight text-balance">Dashboard</h1>
        </div>
      </div>

      <div className="flex-1 space-y-4 px-4 pb-6 pt-4 sm:px-6 lg:px-8 lg:pt-6">
        <ScrimDashboard />
      </div>
    </main>
  );
}
