"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Clock3,
  ListChecks,
  RefreshCw,
  Zap,
  Music,
  HardDrive,
  TrendingUp,
} from "lucide-react";

interface Stats {
  totalTracks: number;
  totalSize: number;
  errorCount: number;
  skippedCount: number;
  successRate: number;
  topArtists: { artist: string; count: number }[];
  formatBreakdown: { format: string; count: number }[];
  monthlyDownloads: { month: string; count: number }[];
}

interface Track {
  id: string;
  status: string;
  progress: number;
  error: string | null;
  created_at: string;
}

interface Job {
  id: string;
  status: string;
  created_at: string;
  tracks: Track[];
}

interface Playlist {
  id: string;
  enabled: number;
  new_tracks_count: number;
  last_checked: string | null;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [statsRes, jobsRes, playlistsRes] = await Promise.all([
        fetch("/api/stats"),
        fetch("/api/jobs?limit=100"),
        fetch("/api/playlists"),
      ]);
      const [statsData, jobsData, playlistsData] = await Promise.all([
        statsRes.json(),
        jobsRes.json(),
        playlistsRes.json(),
      ]);
      setStats(statsData);
      setJobs(jobsData.jobs || []);
      setPlaylists(playlistsData.playlists || []);
      setLastUpdated(new Date());
    } catch {
      // keep stale data
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 10000);
    return () => clearInterval(timer);
  }, [refresh]);

  const derived = useMemo(() => {
    if (!stats) return null;
    const activeJobs = jobs.filter((j) => !["done", "error"].includes(j.status));
    const activeTracks = activeJobs.flatMap((j) => j.tracks || []);
    const downloadingTracks = activeTracks.filter((t) => t.status === "downloading");
    const avgProgress = downloadingTracks.length
      ? Math.round(
          downloadingTracks.reduce((sum, t) => sum + (t.progress || 0), 0) /
            downloadingTracks.length
        )
      : 0;

    const last24h = Date.now() - 24 * 60 * 60 * 1000;
    const recentDone = jobs
      .flatMap((j) => j.tracks || [])
      .filter(
        (t) => t.status === "done" && new Date(t.created_at).getTime() >= last24h
      ).length;

    const enabledPlaylists = playlists.filter((p) => p.enabled === 1);
    const pendingPlaylistNew = enabledPlaylists.reduce(
      (sum, p) => sum + (p.new_tracks_count || 0),
      0
    );
    const stalePlaylists = enabledPlaylists.filter((p) => {
      if (!p.last_checked) return true;
      return Date.now() - new Date(p.last_checked).getTime() > 2 * 60 * 60 * 1000;
    }).length;

    const currentMonth =
      stats.monthlyDownloads[stats.monthlyDownloads.length - 1]?.count || 0;
    const prevMonth =
      stats.monthlyDownloads[stats.monthlyDownloads.length - 2]?.count || 0;
    const monthDelta = currentMonth - prevMonth;
    const monthDeltaPct =
      prevMonth > 0
        ? Math.round((monthDelta / prevMonth) * 100)
        : currentMonth > 0
          ? 100
          : 0;

    const healthScore = Math.max(
      0,
      Math.min(
        100,
        Math.round(
          stats.successRate * 0.7 +
            (pendingPlaylistNew === 0 ? 10 : 4) +
            (activeJobs.length > 0 ? 6 : 2) -
            Math.min(stalePlaylists * 4, 20)
        )
      )
    );

    return {
      activeJobs,
      downloadingTracks,
      avgProgress,
      recentDone,
      enabledPlaylists,
      pendingPlaylistNew,
      stalePlaylists,
      monthDelta,
      monthDeltaPct,
      healthScore,
    };
  }, [jobs, playlists, stats]);

  if (loading && !stats) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-fg">
        Loading dashboard...
      </div>
    );
  }
  if (!stats || !derived) return null;

  const maxMonthly = Math.max(...stats.monthlyDownloads.map((m) => m.count), 1);

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-3 animate-slide-up">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <span className="gradient-text">Dashboard</span>
          </h1>
          <p className="text-xs text-muted-fg mt-1">
            Live operational overview for queue, playlists, and library growth.
          </p>
        </div>
        <button
          onClick={refresh}
          className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm text-muted-fg hover:text-fg hover:border-primary transition-all card-hover btn-shine"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="relative group bg-card border border-border rounded-2xl p-4 card-hover gradient-border animate-slide-up">
          <div className="absolute top-0 right-0 w-16 h-16 bg-primary/10 rounded-full blur-2xl group-hover:bg-primary/20 transition-all" />
          <Music className="h-5 w-5 text-primary mb-2" />
          <p className="text-xs text-muted-fg">Total Tracks</p>
          <p className="text-2xl font-bold">{stats.totalTracks.toLocaleString()}</p>
        </div>
        <div className="relative group bg-card border border-border rounded-2xl p-4 card-hover gradient-border animate-slide-up delay-75">
          <div className="absolute top-0 right-0 w-16 h-16 bg-blue-500/10 rounded-full blur-2xl group-hover:bg-blue-500/20 transition-all" />
          <HardDrive className="h-5 w-5 text-blue-400 mb-2" />
          <p className="text-xs text-muted-fg">Storage Used</p>
          <p className="text-2xl font-bold">{formatBytes(stats.totalSize)}</p>
        </div>
        <div className="relative group bg-card border border-border rounded-2xl p-4 card-hover gradient-border animate-slide-up delay-150">
          <div className="absolute top-0 right-0 w-16 h-16 bg-success/10 rounded-full blur-2xl group-hover:bg-success/20 transition-all" />
          <Zap className="h-5 w-5 text-success mb-2" />
          <p className="text-xs text-muted-fg">System Health</p>
          <p className="text-2xl font-bold gradient-text">{derived.healthScore}%</p>
        </div>
        <div className="relative group bg-card border border-border rounded-2xl p-4 card-hover gradient-border animate-slide-up delay-225">
          <div className="absolute top-0 right-0 w-16 h-16 bg-warning/10 rounded-full blur-2xl group-hover:bg-warning/20 transition-all" />
          <TrendingUp className="h-5 w-5 text-warning mb-2" />
          <p className="text-xs text-muted-fg">24h Throughput</p>
          <p className="text-2xl font-bold">{derived.recentDone}</p>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <div className="relative group bg-card border border-border rounded-2xl p-5 card-hover gradient-border animate-slide-up delay-300">
          <Activity className="h-5 w-5 text-primary mb-2" />
          <p className="text-xs text-muted-fg">Queue Pulse</p>
          <p className="text-xl font-semibold">{derived.activeJobs.length} active jobs</p>
          <p className="text-xs text-muted-fg mt-1">
            {derived.downloadingTracks.length} downloading • avg {derived.avgProgress}%
          </p>
        </div>
        <div className="relative group bg-card border border-border rounded-2xl p-5 card-hover gradient-border animate-slide-up delay-375">
          <ListChecks className="h-5 w-5 text-success mb-2" />
          <p className="text-xs text-muted-fg">Playlist Monitor</p>
          <p className="text-xl font-semibold">{derived.enabledPlaylists.length} enabled</p>
          <p className="text-xs text-muted-fg mt-1">
            {derived.pendingPlaylistNew} new • {derived.stalePlaylists} stale
          </p>
        </div>
        <div className="relative group bg-card border border-border rounded-2xl p-5 card-hover gradient-border animate-slide-up delay-450">
          <Clock3 className="h-5 w-5 text-warning mb-2" />
          <p className="text-xs text-muted-fg">Monthly Trend</p>
          <p className="text-xl font-semibold">
            {derived.monthDelta >= 0 ? "+" : ""}{derived.monthDelta} tracks
          </p>
          <p className="text-xs text-muted-fg mt-1">
            {derived.monthDeltaPct >= 0 ? "+" : ""}{derived.monthDeltaPct}% vs prev month
          </p>
        </div>
      </div>

      {stats.monthlyDownloads.length > 0 && (
        <section className="animate-slide-up delay-300">
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <span className="gradient-text">Monthly Downloads</span>
          </h2>
          <div className="flex items-end gap-2 h-40 rounded-2xl border border-border bg-card p-4">
            {stats.monthlyDownloads.map((m) => (
              <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
                <span className="text-[10px] text-muted-fg">{m.count}</span>
                <div
                  className="w-full rounded-t bg-gradient-to-t from-primary to-purple-400 transition-all min-h-[2px] hover:from-primary/80"
                  style={{ height: `${(m.count / maxMonthly) * 100}%` }}
                />
                <span className="text-[10px] text-muted-fg">{m.month.slice(5)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        {stats.topArtists.length > 0 && (
          <section className="animate-slide-up delay-375">
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <span className="gradient-text">Top Artists</span>
            </h2>
            <div className="rounded-2xl border border-border bg-card divide-y divide-border overflow-hidden">
              {stats.topArtists.map((a, i) => (
                <div key={a.artist} className="flex items-center gap-3 px-4 py-3 hover:bg-primary/5 transition-colors">
                  <span className="text-xs text-muted-fg w-5 text-right font-mono">{i + 1}</span>
                  <span className="text-sm flex-1 truncate">{a.artist}</span>
                  <span className="text-xs text-primary bg-primary/10 px-2 py-1 rounded-full">{a.count}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {stats.formatBreakdown.length > 0 && (
          <section className="animate-slide-up delay-450">
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <span className="gradient-text">Format Breakdown</span>
            </h2>
            <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
              {stats.formatBreakdown.map((f) => {
                const pct = Math.round((f.count / stats.totalTracks) * 100);
                return (
                  <div key={f.format}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="uppercase font-medium">{f.format}</span>
                      <span className="text-muted-fg">
                        {f.count} ({pct}%)
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-secondary">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>

      <div className="text-[11px] text-muted-fg flex items-center gap-3 pt-4 border-t border-border animate-fade-in">
        <div className="flex items-center gap-1">
          <Clock3 className="h-3.5 w-3.5" />
          <span>Updated {lastUpdated ? lastUpdated.toLocaleTimeString() : "never"}</span>
        </div>
        <div className="flex items-center gap-1">
          <Activity className="h-3.5 w-3.5 text-success" />
          <span>{stats.successRate}% success</span>
        </div>
        {stats.errorCount > 0 && (
          <div className="flex items-center gap-1">
            <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
            <span>{stats.errorCount} errors</span>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 mb-2">{icon}</div>
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs text-muted-fg">{label}</p>
    </div>
  );
}
