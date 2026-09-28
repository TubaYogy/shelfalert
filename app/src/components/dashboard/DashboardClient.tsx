"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, RotateCw, CalendarClock, AlertTriangle, Library, Search, X } from "lucide-react";
import { Button, Card, CardBody, Spinner } from "@/components/ui";
import { ReleaseCard, type ReleaseCardData } from "./ReleaseCard";
import { StatusBadge } from "./StatusBadge";
import { monthKey, monthLabel, formatDate } from "@/lib/utils";
import { LetterFilterBar, letterOf, activeLettersFor } from "@/components/letter-filter-bar";

/** Surname = last whitespace-separated word of the name. */
function surnameOf(name: string): string {
  const parts = (name ?? "").trim().split(/\s+/);
  return parts.length ? parts[parts.length - 1] : "";
}

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
  const [authorSearch, setAuthorSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const [upcomingLetter, setUpcomingLetter] = useState("");
  const [recentLetter, setRecentLetter] = useState("");
  const [seriesLetter, setSeriesLetter] = useState("");
  const [recentMissingOnly, setRecentMissingOnly] = useState(false);
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

      // Sync runs in the background — the POST returns 202 immediately.
      const res = await fetch(url, { method: "POST" });
      const result = await res.json();

      if (result.running === false) {
        // Shouldn't happen, but handle gracefully.
        setToast(result.message ?? "Sync complete");
        setSyncing(null);
        await load();
        return;
      }

      setToast("Sync running in the background — this may take several minutes for large libraries…");

      // Poll /api/sync/status until the sync finishes.
      const poll = setInterval(async () => {
        try {
          const statusRes = await fetch("/api/sync/status");
          const status = await statusRes.json();
          if (!status.running) {
            clearInterval(poll);
            setSyncing(null);
            setToast(status.lastSyncStatus ?? "Sync complete");
            await load();
            setTimeout(() => setToast(null), 8000);
          }
        } catch {
          // Keep polling — a transient error doesn't mean the sync stopped.
        }
      }, 5000); // poll every 5 seconds
    } catch {
      setToast("Could not reach the server — check the server logs.");
      setSyncing(null);
      setTimeout(() => setToast(null), 6000);
    }
  }

  const visibleAuthors = useMemo(() => {
    const q = authorSearch.trim().toLowerCase();
    if (!q) return authors;
    return authors.filter((a) => a.name.toLowerCase().includes(q));
  }, [authors, authorSearch]);

  const filtered = useMemo(() => {
    if (!data) return [];
    if (selectedAuthor === "all") return data.releases;
    return data.releases.filter((r) => r.authorId === selectedAuthor);
  }, [data, selectedAuthor]);

  const upcoming = filtered.filter((r) => r.status === "UPCOMING");
  const recent = filtered.filter((r) => r.status === "RECENT" || r.status === "MISSING");

  // Per-section A-Z filters (each section owns its own selection).
  const upcomingActiveLetters = useMemo(
    () => activeLettersFor(upcoming.map((r) => surnameOf(r.author.name))),
    [upcoming]
  );
  const recentActiveLetters = useMemo(
    () => activeLettersFor(recent.map((r) => surnameOf(r.author.name))),
    [recent]
  );
  const seriesActiveLetters = useMemo(
    () => activeLettersFor((data?.seriesGaps ?? []).map((g) => g.seriesName)),
    [data]
  );

  const upcomingFiltered = useMemo(
    () =>
      upcomingLetter
        ? upcoming.filter((r) => letterOf(surnameOf(r.author.name)) === upcomingLetter)
        : upcoming,
    [upcoming, upcomingLetter]
  );
  const recentFiltered = useMemo(() => {
    let list = recentMissingOnly ? recent.filter((r) => r.status === "MISSING") : recent;
    if (recentLetter) list = list.filter((r) => letterOf(surnameOf(r.author.name)) === recentLetter);
    return list;
  }, [recent, recentLetter, recentMissingOnly]);
  const seriesGapsFiltered = useMemo(() => {
    const gaps = data?.seriesGaps ?? [];
    return seriesLetter ? gaps.filter((g) => letterOf(g.seriesName) === seriesLetter) : gaps;
  }, [data, seriesLetter]);

  const upcomingByMonth = useMemo(() => {
    const groups = new Map<string, ReleaseCardData[]>();
    for (const r of upcomingFiltered) {
      const key = r.publishDate ? monthKey(new Date(r.publishDate)) : "tba";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(r);
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [upcomingFiltered]);

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
        <aside className="flex flex-col gap-2">
          <h2 className="px-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Authors
          </h2>

          {/* Search box */}
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              ref={searchRef}
              type="text"
              placeholder="Search authors…"
              value={authorSearch}
              onChange={(e) => setAuthorSearch(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-8 text-sm text-slate-800 placeholder-slate-400 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-500 dark:focus:border-brand-500"
            />
            {authorSearch && (
              <button
                onClick={() => { setAuthorSearch(""); searchRef.current?.focus(); }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* "All authors" always visible */}
          <div className="space-y-0.5 overflow-y-auto" style={{ maxHeight: "70vh" }}>
            {!authorSearch && (
              <button
                onClick={() => setSelectedAuthor("all")}
                className={filterClass(selectedAuthor === "all")}
              >
                All authors
              </button>
            )}
            {visibleAuthors.length === 0 && authorSearch ? (
              <p className="px-2 py-3 text-xs text-slate-400">No authors match "{authorSearch}"</p>
            ) : (
              visibleAuthors.map((a) => (
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
              ))
            )}
          </div>
        </aside>

        {/* Timeline */}
        <div className="space-y-8">
          <section>
            <h2 className="mb-3 text-lg font-semibold">Upcoming Releases</h2>
            {upcoming.length > 0 && (
              <div className="mb-3">
                <LetterFilterBar
                  items={upcoming.map((r) => ({ key: surnameOf(r.author.name) }))}
                  activeLetters={upcomingActiveLetters}
                  selected={upcomingLetter}
                  onSelect={setUpcomingLetter}
                />
              </div>
            )}
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
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">
                Recently Released{" "}
                <span className="text-sm font-normal text-slate-400">(past window)</span>
              </h2>
              <button
                onClick={() => setRecentMissingOnly((v) => !v)}
                className={[
                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  recentMissingOnly
                    ? "border-orange-400 bg-orange-50 text-orange-700 dark:border-orange-500 dark:bg-orange-500/10 dark:text-orange-300"
                    : "border-slate-300 bg-white text-slate-500 hover:border-slate-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-500",
                ].join(" ")}
              >
                {recentMissingOnly ? "⚠ Missing only" : "Show all"}
              </button>
            </div>
            {recent.length > 0 && (
              <div className="mb-3">
                <LetterFilterBar
                  items={recent.map((r) => ({ key: surnameOf(r.author.name) }))}
                  activeLetters={recentActiveLetters}
                  selected={recentLetter}
                  onSelect={setRecentLetter}
                />
              </div>
            )}
            {recentFiltered.length === 0 ? (
              <EmptyState message="No recent releases in the tracking window." />
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {recentFiltered.map((r) => (
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
              <div className="mb-3">
                <LetterFilterBar
                  items={data.seriesGaps.map((g) => ({ key: g.seriesName }))}
                  activeLetters={seriesActiveLetters}
                  selected={seriesLetter}
                  onSelect={setSeriesLetter}
                />
              </div>
              <Card>
                <CardBody className="divide-y divide-slate-100 p-0 dark:divide-slate-800">
                  {seriesGapsFiltered.length === 0 ? (
                    <div className="px-4 py-6 text-center text-sm text-slate-400">
                      No series starting with “{seriesLetter}”.
                    </div>
                  ) : (
                    seriesGapsFiltered.map((g) => (
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
                    ))
                  )}
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
