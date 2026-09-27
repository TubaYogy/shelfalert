"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";

interface WidgetItem {
  title: string;
  author: string;
  publishDate: string | null;
  coverUrl: string | null;
  status: string;
  daysUntil: number | null;
  seriesName: string | null;
  seriesNumber: number | null;
}

interface WidgetData {
  upcoming: WidgetItem[];
  missing: number;
  total: number;
  lastSync: string | null;
}

/**
 * Lightweight, self-contained (inline-styled) widget page for embedding in an
 * iframe inside Homarr. Supports ?token=&theme=dark|light&limit=5. Auto-refreshes
 * every 30 minutes.
 */
export function WidgetView() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const theme = params.get("theme") === "light" ? "light" : "dark";
  const limit = Math.min(Math.max(Number(params.get("limit") ?? "5"), 1), 25);

  const [data, setData] = useState<WidgetData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const palette =
    theme === "dark"
      ? { bg: "#0f172a", card: "#1e293b", text: "#f1f5f9", sub: "#94a3b8", border: "#334155" }
      : { bg: "#f8fafc", card: "#ffffff", text: "#0f172a", sub: "#64748b", border: "#e2e8f0" };

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/widget/upcoming?token=${encodeURIComponent(token)}&limit=${limit}`);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? `Error ${res.status}`);
        return;
      }
      setData(await res.json());
      setError(null);
    } catch {
      setError("Network error");
    }
  }, [token, limit]);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 30 * 60 * 1000);
    return () => clearInterval(id);
  }, [load]);

  const statusColor = (s: string) =>
    s === "UPCOMING" ? "#3b82f6" : s === "RECENT" ? "#22c55e" : "#f97316";

  return (
    <div
      style={{
        fontFamily: "system-ui, -apple-system, sans-serif",
        background: palette.bg,
        color: palette.text,
        minHeight: "100vh",
        margin: 0,
        padding: 12,
        boxSizing: "border-box",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <strong style={{ fontSize: 14 }}>📚 Upcoming Releases</strong>
        {data && (
          <span style={{ fontSize: 11, color: palette.sub }}>
            {data.total} tracked · {data.missing} missing
          </span>
        )}
      </div>

      {error && <div style={{ fontSize: 12, color: "#f97316" }}>{error}</div>}

      {!error && !data && <div style={{ fontSize: 12, color: palette.sub }}>Loading…</div>}

      {data && data.upcoming.length === 0 && !error && (
        <div style={{ fontSize: 12, color: palette.sub }}>No upcoming releases.</div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {data?.upcoming.map((item, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              gap: 10,
              background: palette.card,
              border: `1px solid ${palette.border}`,
              borderRadius: 8,
              padding: 8,
            }}
          >
            {item.coverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.coverUrl}
                alt=""
                width={36}
                height={52}
                style={{ borderRadius: 4, objectFit: "cover", flexShrink: 0 }}
              />
            ) : (
              <div
                style={{
                  width: 36,
                  height: 52,
                  borderRadius: 4,
                  background: palette.border,
                  flexShrink: 0,
                }}
              />
            )}
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {item.title}
              </div>
              <div style={{ fontSize: 11, color: palette.sub }}>{item.author}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: statusColor(item.status),
                  }}
                >
                  {item.daysUntil != null ? `in ${item.daysUntil}d` : "TBA"}
                </span>
                <span style={{ fontSize: 10, color: palette.sub }}>{item.publishDate ?? ""}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {data?.lastSync && (
        <div style={{ fontSize: 10, color: palette.sub, marginTop: 10, textAlign: "right" }}>
          Synced {new Date(data.lastSync).toLocaleDateString()}
        </div>
      )}
    </div>
  );
}
