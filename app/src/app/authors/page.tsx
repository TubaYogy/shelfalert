import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { Navbar } from "@/components/layout/Navbar";
import { AuthorsClient } from "@/components/authors/AuthorsClient";

export const dynamic = "force-dynamic";

export default async function AuthorsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <div className="min-h-screen">
      <Navbar username={session.username} />
      <main className="mx-auto max-w-6xl px-4 py-6">
        <AuthorsClient />
      </main>
    </div>
  );
}
