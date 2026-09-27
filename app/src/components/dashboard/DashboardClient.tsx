"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, RotateCw, CalendarClock, AlertTriangle, Library } from "lucide-react";
import { Button, Card, CardBody, Spinner } from "@/components/ui";
import { ReleaseCard, type ReleaseCardData } from "./ReleaseCard";
import { StatusBadge } from "./StatusBadge";
import { monthKey, monthLabel, formatDate } from "@/lib/utils";

interface SeriesGap {
  id: number;
  seriesName: string;
  authorName: string | null;
  missingNumber: number;
}

interface ReleasesResponse {
  releases: (ReleaseCardData & { authorId: number })[];
  counts: { upcoming: number; recent: number; missing: number; total: number };
  seriesGaps: SeriesGap[];
}

interface AuthorLite {
  id: number;
  name: string;
  upcomingReleases: number;
}

export function DashboardClient() {
  const [data, setData] = useState<ReleasesResponse | null>(null);
  const [authors, setAuthors] = useState<AuthorLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAuthor, setSelectedAuthor] = useState<number | "all">("all");
  const [syncing, setSyncing] = useState<null | "authors" | "releases" | "full">(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rel, auth, settings] = await Promise.all([
        fetch("/api/releases").then((r) => r.json()),
        fetch("/api/authors").then((r) => r.json()),
        fetch("/api/settings").then((r) => r.json()),
      ]);
      setData(rel);
      setAuthors(Array.isArray(auth) ? auth : []);
      setLastSync(settings.lastReleaseSync ?? null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function runSync(kind: "authors" | "releases" | "full") {
    setSyncing(kind);
    setToast(null);
    try {
      const url =
        kind === "authors"
          ? "/api/sync/bookorbit"
          : kind === "full"
            ? "/api/sync/releases?full=1"
            : "/api/sync/releases";
      const res = await fetch(url, { method: "POST" });
      const result = await res.json();
      setToast(result.message ?? result.error ?? "Sync complete");
      await load();
    } catch {
      setToast("Sync failed — check the server logs.");
    } finally {
      setSyncing(null);
      setTimeout(() => setToast(null), 6000);
    }
  }

  const filtered = useMemo(() => {
    if (!data) return [];
    if (selectedAuthor === "all") return data.releases;
    return data.releases.filter((r) => r.authorId === selectedAuthor);
  }, [data, selectedAuthor]);

  const upcoming = filtered.filter((r) => r.status === "UPCOMING");
  const recent = filtered.filter((r) => r.status === "RECENT" || r.status === "MISSING");

  const upcomingByMonth = useMemo(() => {
    const groups = new Map<string, ReleaseCardData[]>();
    for (const r of upcoming) {
      const key = r.publishDate ? monthKey(new Date(r.publishDate)) : "tba";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(r);
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [upcoming]);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-400">
        <Spinner className="mr-2 h-6 w-6" /> Loading releases…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header + actions */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Release Timeline</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Last sync: {lastSync ? formatDate(lastSync) + " " + new Date(lastSync).toLocaleTimeString() : "never"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => runSync("authors")} disabled={!!syncing}>
            {syncing === "authors" ? <Spinner /> : <RefreshCw className="h-4 w-4" />}
            Sync Authors
          </Button>
          <Button variant="outline" size="sm" onClick={() => runSync("releases")} disabled={!!syncing}>
            {syncing === "releases" ? <Spinner /> : <RotateCw className="h-4 w-4" />}
            Refresh Releases
          </Button>
          <Button size="sm" onClick={() => runSync("full")} disabled={!!syncing}>
            {syncing === "full" ? <Spinner /> : <RefreshCw className="h-4 w-4" />}
            Full Sync
          </Button>
        </div>
      </div>

      {toast && (
        <div className="rounded-lg bg-brand-50 px-4 py-3 text-sm text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">
          {toast}
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={<CalendarClock className="h-5 w-5" />} label="Upcoming" value={data?.counts.upcoming ?? 0} tone="blue" />
        <StatCard icon={<Library className="h-5 w-5" />} label="In Library" value={data?.counts.recent ?? 0} tone="green" />
        <StatCard icon={<AlertTriangle className="h-5 w-5" />} label="Missing" value={data?.counts.missing ?? 0} tone="orange" />
        <StatCard icon={<Library className="h-5 w-5" />} label="Total tracked" value={data?.counts.total ?? 0} tone="slate" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[220px_1fr]">
        {/* Author filter sidebar */}
        <aside className="space-y-1">
          <h2 className="mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Authors
          </h2>
          <button
            onClick={() => setSelectedAuthor("all")}
            className={filterClass(selectedAuthor === "all")}
          >
            All authors
          </button>
          {authors.map((a) => (
            <button
              key={a.id}
              onClick={() => setSelectedAuthor(a.id)}
              className={filterClass(selectedAuthor === a.id)}
            >
              <span className="truncate">{a.name}</span>
              {a.upcomingReleases > 0 && (
                <span className="ml-auto rounded-full bg-brand-100 px-1.5 text-xs text-brand-700 dark:bg-brand-500/20 dark:text-brand-300">
                  {a.upcomingReleases}
                </span>
              )}
            </button>
          ))}
        </aside>

        {/* Timeline */}
        <div className="space-y-8">
          <section>
            <h2 className="mb-3 text-lg font-semibold">Upcoming Releases</h2>
            {upcomingByMonth.length === 0 ? (
              <EmptyState message="No upcoming releases in the tracking window. Try running a sync." />
            ) : (
              <div className="space-y-6">
                {upcomingByMonth.map(([key, items]) => (
                  <div key={key}>
                    <h3 className="mb-2 text-sm font-semibold text-slate-500 dark:text-slate-400">
                      {key === "tba" ? "Date TBA" : monthLabel(key)}
                    </h3>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      {items.map((r) => (
                        <ReleaseCard key={r.id} release={r} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold">
              Recently Released{" "}
              <span className="text-sm font-normal text-slate-400">(past window)</span>
            </h2>
            {recent.length === 0 ? (
              <EmptyState message="No recent releases in the tracking window." />
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {recent.map((r) => (
                  <ReleaseCard key={r.id} release={r} />
                ))}
              </div>
            )}
          </section>

          {data && data.seriesGaps.length > 0 && (
            <section>
              <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
                <AlertTriangle className="h-5 w-5 text-orange-500" />
                Missing in Series
              </h2>
              <Card>
                <CardBody className="divide-y divide-slate-100 p-0 dark:divide-slate-800">
                  {data.seriesGaps.map((g) => (
                    <div key={g.id} className="flex items-center justify-between px-4 py-3">
                      <div>
                        <p className="text-sm font-medium">{g.seriesName}</p>
                        {g.authorName && (
                          <p className="text-xs text-slate-500 dark:text-slate-400">{g.authorName}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-slate-500">Book #{g.missingNumber}</span>
                        <StatusBadge status="MISSING" />
                      </div>
                    </div>
                  ))}
                </CardBody>
              </Card>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: "blue" | "green" | "orange" | "slate";
}) {
  const tones: Record<string, string> = {
    blue: "text-blue-600 dark:text-blue-400",
    green: "text-green-600 dark:text-green-400",
    orange: "text-orange-600 dark:text-orange-400",
    slate: "text-slate-600 dark:text-slate-300",
  };
  return (
    <Card>
      <CardBody className="flex items-center gap-3">
        <span className={tones[tone]}>{icon}</span>
        <div>
          <p className="text-2xl font-bold">{value}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
        </div>
      </CardBody>
    </Card>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 py-10 text-center text-sm text-slate-400 dark:border-slate-700">
      {message}
    </div>
  );
}

function filterClass(active: boolean): string {
  return [
    "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors",
    active
      ? "bg-brand-50 font-medium text-brand-700 dark:bg-brand-500/10 dark:text-brand-300"
      : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
  ].join(" ");
}
