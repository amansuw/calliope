"use client";

import { useState, useEffect } from "react";
import { Search, Music, FolderOpen, RefreshCw, Disc3, Clock, HardDrive } from "lucide-react";

interface LibraryTrack {
  id: string;
  file_path: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  duration_s: number | null;
}

interface Stats {
  trackCount: number;
  totalSize: number;
  lastScanned: string | null;
}

function formatSize(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}

function formatDuration(s: number | null): string {
  if (!s) return "--:--";
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export default function LibraryPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [tracks, setTracks] = useState<LibraryTrack[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    fetchStats();
    fetchTracks();
  }, []);

  const fetchStats = async () => {
    const res = await fetch("/api/library/scan");
    const data = await res.json();
    setStats(data);
  };

  const fetchTracks = async (query = "") => {
    setLoading(true);
    const url = query
      ? `/api/library/scan?action=search&q=${encodeURIComponent(query)}`
      : "/api/library/scan?action=tracks";
    const res = await fetch(url);
    const data = await res.json();
    setTracks(data.tracks || []);
    setLoading(false);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchTracks(search);
  };

  const handleScan = async () => {
    setScanning(true);
    await fetch("/api/library/scan", { method: "POST" });
    await fetchStats();
    await fetchTracks(search);
    setScanning(false);
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8 animate-slide-up">
        <h1 className="text-2xl font-bold flex items-center gap-3">
          <div className="relative">
            <div className="absolute inset-0 bg-primary/30 blur-xl" />
            <FolderOpen className="w-7 h-7 text-primary relative" />
          </div>
          <span className="gradient-text">Music Library</span>
        </h1>
        <button
          onClick={handleScan}
          disabled={scanning}
          className="relative group flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-primary to-purple-500 text-white rounded-xl font-medium transition-all duration-300 hover:scale-105 disabled:opacity-50 btn-shine"
        >
          <RefreshCw className={`w-4 h-4 ${scanning ? "animate-spin-slow" : ""}`} />
          {scanning ? "Scanning..." : "Rescan"}
          <div className="absolute inset-0 rounded-xl bg-white/20 opacity-0 group-hover:opacity-100 transition-opacity" />
        </button>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="relative group bg-card border border-border rounded-2xl p-5 card-hover gradient-border">
            <div className="absolute top-0 right-0 w-20 h-20 bg-primary/10 rounded-full blur-2xl group-hover:bg-primary/20 transition-all" />
            <div className="flex items-center gap-3 mb-2">
              <Disc3 className="w-5 h-5 text-primary" />
              <span className="text-sm text-muted-fg">Total Tracks</span>
            </div>
            <div className="text-3xl font-bold gradient-text">{stats.trackCount.toLocaleString()}</div>
          </div>
          
          <div className="relative group bg-card border border-border rounded-2xl p-5 card-hover gradient-border">
            <div className="absolute top-0 right-0 w-20 h-20 bg-success/10 rounded-full blur-2xl group-hover:bg-success/20 transition-all" />
            <div className="flex items-center gap-3 mb-2">
              <HardDrive className="w-5 h-5 text-success" />
              <span className="text-sm text-muted-fg">Library Size</span>
            </div>
            <div className="text-3xl font-bold text-fg">{formatSize(stats.totalSize)}</div>
          </div>
          
          <div className="relative group bg-card border border-border rounded-2xl p-5 card-hover gradient-border">
            <div className="absolute top-0 right-0 w-20 h-20 bg-warning/10 rounded-full blur-2xl group-hover:bg-warning/20 transition-all" />
            <div className="flex items-center gap-3 mb-2">
              <Clock className="w-5 h-5 text-warning" />
              <span className="text-sm text-muted-fg">Last Scanned</span>
            </div>
            <div className="text-xl font-semibold text-fg">
              {stats.lastScanned ? new Date(stats.lastScanned).toLocaleDateString() : "Never"}
            </div>
          </div>
        </div>
      )}

      {/* Search */}
      <form onSubmit={handleSearch} className="mb-6 animate-slide-up delay-150">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-fg" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by title, artist, or album..."
            className="w-full pl-12 pr-4 py-3 bg-card border border-border rounded-xl text-fg placeholder:text-muted-fg focus:outline-none focus:border-primary input-glow transition-all"
          />
          {search && (
            <button
              type="button"
              onClick={() => {
                setSearch("");
                fetchTracks();
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-fg hover:text-fg transition-colors"
            >
              ×
            </button>
          )}
        </div>
      </form>

      {/* Table */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden animate-slide-up delay-225">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left p-4 text-sm font-medium text-muted-fg">Title</th>
                <th className="text-left p-4 text-sm font-medium text-muted-fg">Artist</th>
                <th className="text-left p-4 text-sm font-medium text-muted-fg">Album</th>
                <th className="text-left p-4 text-sm font-medium text-muted-fg w-24">Duration</th>
                <th className="text-left p-4 text-sm font-medium text-muted-fg">Path</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center">
                    <div className="flex items-center justify-center gap-2 text-muted-fg">
                      <RefreshCw className="w-5 h-5 animate-spin" />
                      Loading...
                    </div>
                  </td>
                </tr>
              ) : tracks.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-muted-fg">
                    <Music className="w-12 h-12 mx-auto mb-2 opacity-30" />
                    <p>No tracks found</p>
                  </td>
                </tr>
              ) : (
                tracks.map((track, idx) => (
                  <tr
                    key={track.id}
                    className="border-b border-border/50 hover:bg-primary/5 transition-colors animate-fade-in"
                    style={{ animationDelay: `${idx * 30}ms` }}
                  >
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                          <Music className="w-4 h-4 text-primary" />
                        </div>
                        <span className="font-medium">{track.title || "Unknown"}</span>
                      </div>
                    </td>
                    <td className="p-4 text-muted-fg">{track.artist || "Unknown"}</td>
                    <td className="p-4 text-muted-fg">{track.album || "-"}</td>
                    <td className="p-4 text-muted-fg font-mono">{formatDuration(track.duration_s)}</td>
                    <td className="p-4 text-xs text-muted-fg font-mono truncate max-w-xs" title={track.file_path}>
                      {track.file_path.split("/").slice(-3).join("/")}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
