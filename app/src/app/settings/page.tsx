import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { Navbar } from "@/components/layout/Navbar";
import { SettingsClient } from "@/components/layout/SettingsClient";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <div className="min-h-screen">
      <Navbar username={session.username} />
      <main className="mx-auto max-w-3xl px-4 py-6">
        <SettingsClient />
      </main>
    </div>
  );
}
