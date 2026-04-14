"use client";

import { useState, useEffect } from "react";
import {
  Music,
  HardDrive,
  CheckCircle,
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

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

export default function StatsPage() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    fetch("/api/stats")
      .then((r) => r.json())
      .then(setStats)
      .catch(() => {});
  }, []);

  if (!stats) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-fg">
        Loading stats...
      </div>
    );
  }

  const maxMonthly = Math.max(...stats.monthlyDownloads.map((m) => m.count), 1);

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">Stats</h1>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          icon={<Music className="h-5 w-5 text-primary" />}
          label="Total Tracks"
          value={String(stats.totalTracks)}
        />
        <StatCard
          icon={<HardDrive className="h-5 w-5 text-blue-400" />}
          label="Storage Used"
          value={formatBytes(stats.totalSize)}
        />
        <StatCard
          icon={<CheckCircle className="h-5 w-5 text-success" />}
          label="Success Rate"
          value={`${stats.successRate}%`}
        />
        <StatCard
          icon={<TrendingUp className="h-5 w-5 text-warning" />}
          label="Errors"
          value={String(stats.errorCount)}
        />
      </div>

      {/* Monthly downloads - simple bar chart */}
      {stats.monthlyDownloads.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-3">Monthly Downloads</h2>
          <div className="flex items-end gap-2 h-40 rounded-xl border border-border bg-card p-4">
            {stats.monthlyDownloads.map((m) => (
              <div
                key={m.month}
                className="flex-1 flex flex-col items-center gap-1"
              >
                <span className="text-[10px] text-muted-fg">
                  {m.count}
                </span>
                <div
                  className="w-full rounded-t bg-primary transition-all min-h-[2px]"
                  style={{
                    height: `${(m.count / maxMonthly) * 100}%`,
                  }}
                />
                <span className="text-[10px] text-muted-fg">
                  {m.month.slice(5)}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        {/* Top Artists */}
        {stats.topArtists.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold mb-3">Top Artists</h2>
            <div className="rounded-xl border border-border bg-card divide-y divide-border">
              {stats.topArtists.map((a, i) => (
                <div
                  key={a.artist}
                  className="flex items-center gap-3 px-4 py-2.5"
                >
                  <span className="text-xs text-muted-fg w-5 text-right">
                    {i + 1}
                  </span>
                  <span className="text-sm flex-1 truncate">{a.artist}</span>
                  <span className="text-xs text-muted-fg">
                    {a.count} tracks
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Format breakdown */}
        {stats.formatBreakdown.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold mb-3">Format Breakdown</h2>
            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
              {stats.formatBreakdown.map((f) => {
                const pct = Math.round(
                  (f.count / stats.totalTracks) * 100
                );
                return (
                  <div key={f.format}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="uppercase font-medium">
                        {f.format}
                      </span>
                      <span className="text-muted-fg">
                        {f.count} ({pct}%)
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-secondary">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
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
