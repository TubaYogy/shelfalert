"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Plus, Trash2, Eye, EyeOff, UserRound } from "lucide-react";
import { Button, Card, CardBody, Input, Spinner } from "@/components/ui";
import { BookCover } from "@/components/dashboard/BookCover";

interface Author {
  id: number;
  name: string;
  photoUrl: string | null;
  bookOrbitId: number | null;
  isActive: boolean;
  source: string;
  totalReleases: number;
  upcomingReleases: number;
}

export function AuthorsClient() {
  const [authors, setAuthors] = useState<Author[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/authors");
      const data = await res.json();
      setAuthors(Array.isArray(data) ? data : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 5000);
  }

  async function syncFromBookOrbit() {
    setSyncing(true);
    try {
      const res = await fetch("/api/sync/bookorbit", { method: "POST" });
      const data = await res.json();
      flash(data.message ?? data.error ?? "Synced");
      await load();
    } finally {
      setSyncing(false);
    }
  }

  async function addAuthor(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setAdding(true);
    try {
      const res = await fetch("/api/authors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        flash(data.error ?? "Could not add author");
      } else {
        setNewName("");
        await load();
      }
    } finally {
      setAdding(false);
    }
  }

  async function toggleActive(a: Author) {
    await fetch(`/api/authors/${a.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !a.isActive }),
    });
    await load();
  }

  async function remove(a: Author) {
    if (!confirm(`Delete "${a.name}" and all their tracked releases?`)) return;
    await fetch(`/api/authors/${a.id}`, { method: "DELETE" });
    await load();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Tracked Authors</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {authors.length} authors · {authors.filter((a) => a.isActive).length} active
          </p>
        </div>
        <Button onClick={syncFromBookOrbit} disabled={syncing}>
          {syncing ? <Spinner /> : <RefreshCw className="h-4 w-4" />}
          Sync from BookOrbit
        </Button>
      </div>

      {toast && (
        <div className="rounded-lg bg-brand-50 px-4 py-3 text-sm text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">
          {toast}
        </div>
      )}

      <Card>
        <CardBody>
          <form onSubmit={addAuthor} className="flex gap-2">
            <Input
              placeholder="Add author manually by name…"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <Button type="submit" disabled={adding || !newName.trim()}>
              {adding ? <Spinner /> : <Plus className="h-4 w-4" />}
              Add
            </Button>
          </form>
        </CardBody>
      </Card>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-400">
          <Spinner className="mr-2 h-6 w-6" /> Loading…
        </div>
      ) : authors.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 py-16 text-center text-sm text-slate-400 dark:border-slate-700">
          No authors yet. Sync from BookOrbit or add one manually above.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {authors.map((a) => (
            <Card key={a.id} className={a.isActive ? "" : "opacity-60"}>
              <CardBody className="flex gap-3">
                {a.photoUrl ? (
                  <BookCover src={a.photoUrl} alt={a.name} className="h-16 w-16 rounded-full" />
                ) : (
                  <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-full bg-slate-200 text-slate-500 dark:bg-slate-700">
                    <UserRound className="h-7 w-7" />
                  </div>
                )}
                <div className="flex min-w-0 flex-1 flex-col">
                  <h3 className="truncate font-semibold">{a.name}</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {a.upcomingReleases} upcoming · {a.totalReleases} tracked
                  </p>
                  <span className="mt-1 inline-flex w-fit rounded-full bg-slate-100 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                    {a.source}
                  </span>
                  <div className="mt-auto flex gap-1 pt-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleActive(a)}
                      title={a.isActive ? "Pause tracking" : "Resume tracking"}
                    >
                      {a.isActive ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => remove(a)}
                      className="text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10"
                      title="Delete author"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
