"use client";

import { useSession } from "next-auth/react";
import ScrimDashboard from "@/components/ScrimDashboard";
import DemoLanding from "@/components/DemoLanding";

export default function HomePage() {
  const { data: session, status } = useSession();

  if (status === "loading") {
    return (
      <main className="w-full p-4 sm:p-6 lg:p-8">
        <div className="flex items-center justify-center py-12">
          <div className="text-center text-zinc-400">Loading...</div>
        </div>
      </main>
    );
  }

  if (!session) {
    return <DemoLanding />;
  }

  return (
    <main className="w-full p-4 sm:p-6 lg:p-8 space-y-5 sm:space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>

      <ScrimDashboard />
    </main>
  );
}
