import ScrimDashboard from "@/components/ScrimDashboard";

export default function HomePage() {
  return (
    <main className="w-full p-4 sm:p-6 lg:p-8 space-y-5 sm:space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>

      <ScrimDashboard />
    </main>
  );
}
