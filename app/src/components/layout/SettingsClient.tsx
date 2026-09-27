"use client";

import { useCallback, useEffect, useState } from "react";
import { Plug, Save, RefreshCw, Copy, Check, KeyRound } from "lucide-react";
import { Button, Card, CardBody, CardHeader, Input, Label, Select, Spinner } from "@/components/ui";

interface SettingsData {
  bookOrbitUrl: string | null;
  hasBookOrbitToken: boolean;
  syncIntervalHours: number;
  lookbackDays: number;
  lookaheadDays: number;
  widgetToken: string;
  widgetJsonUrl: string;
  widgetIframeUrl: string;
  lastBookOrbitSync: string | null;
  lastReleaseSync: string | null;
  lastSyncStatus: string | null;
  oidcEnabled: boolean;
}

export function SettingsClient() {
  const [data, setData] = useState<SettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [interval, setInterval] = useState(24);
  const [lookback, setLookback] = useState(60);
  const [lookahead, setLookahead] = useState(90);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings");
      const d: SettingsData = await res.json();
      setData(d);
      setUrl(d.bookOrbitUrl ?? "");
      setInterval(d.syncIntervalHours);
      setLookback(d.lookbackDays);
      setLookahead(d.lookaheadDays);
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

  async function save() {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        bookOrbitUrl: url,
        syncIntervalHours: interval,
        lookbackDays: lookback,
        lookaheadDays: lookahead,
      };
      if (token) body.bookOrbitToken = token;
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setToken("");
        flash("Settings saved");
        await load();
      } else {
        flash("Could not save settings");
      }
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookOrbitUrl: url, bookOrbitToken: token || undefined }),
      });
      const d = await res.json();
      if (res.ok) {
        setTestResult({ ok: true, msg: `Connected — ${d.authorCount} authors visible.` });
      } else {
        setTestResult({ ok: false, msg: d.error ?? "Connection failed" });
      }
    } catch {
      setTestResult({ ok: false, msg: "Network error" });
    } finally {
      setTesting(false);
    }
  }

  async function regenerateWidgetToken() {
    if (!confirm("Regenerate the widget token? Existing Homarr widgets will need updating.")) return;
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ regenerateWidgetToken: true }),
    });
    if (res.ok) {
      flash("Widget token regenerated");
      await load();
    }
  }

  async function runFullSync() {
    flash("Full sync started…");
    const res = await fetch("/api/sync/releases?full=1", { method: "POST" });
    const d = await res.json();
    flash(d.message ?? d.error ?? "Sync complete");
    await load();
  }

  function copy(text: string, key: string) {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  }

  if (loading || !data) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-400">
        <Spinner className="mr-2 h-6 w-6" /> Loading settings…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      {toast && (
        <div className="rounded-lg bg-brand-50 px-4 py-3 text-sm text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">
          {toast}
        </div>
      )}

      {/* BookOrbit connection */}
      <Card>
        <CardHeader>
          <h2 className="flex items-center gap-2 font-semibold">
            <Plug className="h-5 w-5 text-brand-600" /> BookOrbit Connection
          </h2>
        </CardHeader>
        <CardBody className="space-y-4">
          <div>
            <Label htmlFor="url">BookOrbit URL</Label>
            <Input
              id="url"
              placeholder="http://192.168.1.50:3000"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="token">
              API Token{" "}
              {data.hasBookOrbitToken && (
                <span className="text-xs font-normal text-green-600 dark:text-green-400">
                  (a token is stored — leave blank to keep it)
                </span>
              )}
            </Label>
            <Input
              id="token"
              type="password"
              placeholder={data.hasBookOrbitToken ? "•••••••• (unchanged)" : "Paste BookOrbit JWT token"}
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </div>
          {testResult && (
            <p
              className={
                testResult.ok
                  ? "rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-500/10 dark:text-green-400"
                  : "rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-500/10 dark:text-red-400"
              }
            >
              {testResult.msg}
            </p>
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={testConnection} disabled={testing}>
              {testing ? <Spinner /> : <Plug className="h-4 w-4" />}
              Test Connection
            </Button>
          </div>
        </CardBody>
      </Card>

      {/* Sync configuration */}
      <Card>
        <CardHeader>
          <h2 className="font-semibold">Sync Configuration</h2>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="interval">Sync interval</Label>
              <Select
                id="interval"
                value={interval}
                onChange={(e) => setInterval(Number(e.target.value))}
              >
                <option value={6}>Every 6 hours</option>
                <option value={12}>Every 12 hours</option>
                <option value={24}>Every 24 hours</option>
                <option value={48}>Every 48 hours</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="lookback">Lookback days</Label>
              <Input
                id="lookback"
                type="number"
                min={0}
                value={lookback}
                onChange={(e) => setLookback(Number(e.target.value))}
              />
            </div>
            <div>
              <Label htmlFor="lookahead">Lookahead days</Label>
              <Input
                id="lookahead"
                type="number"
                min={0}
                value={lookahead}
                onChange={(e) => setLookahead(Number(e.target.value))}
              />
            </div>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Last BookOrbit sync:{" "}
            {data.lastBookOrbitSync ? new Date(data.lastBookOrbitSync).toLocaleString() : "never"} ·
            Last release sync:{" "}
            {data.lastReleaseSync ? new Date(data.lastReleaseSync).toLocaleString() : "never"}
          </p>
          {data.lastSyncStatus && (
            <p className="text-xs text-slate-500 dark:text-slate-400">Status: {data.lastSyncStatus}</p>
          )}
        </CardBody>
      </Card>

      {/* Widget */}
      <Card>
        <CardHeader>
          <h2 className="flex items-center gap-2 font-semibold">
            <KeyRound className="h-5 w-5 text-brand-600" /> Homarr Widget
          </h2>
        </CardHeader>
        <CardBody className="space-y-4">
          <CopyRow
            label="JSON endpoint (Homarr custom widget)"
            value={data.widgetJsonUrl}
            copied={copied === "json"}
            onCopy={() => copy(data.widgetJsonUrl, "json")}
          />
          <CopyRow
            label="iFrame widget URL"
            value={data.widgetIframeUrl}
            copied={copied === "iframe"}
            onCopy={() => copy(data.widgetIframeUrl, "iframe")}
          />
          <Button variant="outline" size="sm" onClick={regenerateWidgetToken}>
            <RefreshCw className="h-4 w-4" /> Regenerate token
          </Button>
        </CardBody>
      </Card>

      {/* OIDC status */}
      <Card>
        <CardBody className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">OIDC / SSO (Authelia · Authentik)</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {data.oidcEnabled
                ? "OIDC environment variables detected."
                : "Not configured. Set OIDC_CLIENT_ID / OIDC_CLIENT_SECRET / OIDC_ISSUER to enable."}
            </p>
          </div>
          <span
            className={
              data.oidcEnabled
                ? "rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700 dark:bg-green-500/20 dark:text-green-300"
                : "rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400"
            }
          >
            {data.oidcEnabled ? "Enabled" : "Disabled"}
          </span>
        </CardBody>
      </Card>

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <Button onClick={save} disabled={saving}>
          {saving ? <Spinner /> : <Save className="h-4 w-4" />}
          Save Settings
        </Button>
        <Button variant="secondary" onClick={runFullSync}>
          <RefreshCw className="h-4 w-4" /> Run Full Sync Now
        </Button>
      </div>
    </div>
  );
}

function CopyRow({
  label,
  value,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input readOnly value={value} className="font-mono text-xs" />
        <Button variant="outline" onClick={onCopy} title="Copy">
          {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}
