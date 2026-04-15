"use client";

import { useState, useEffect } from "react";
import { Search, Music, FolderOpen, RefreshCw } from "lucide-react";

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
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <FolderOpen className="w-6 h-6" />
          Music Library
        </h1>
        <button
          onClick={handleScan}
          disabled={scanning}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${scanning ? "animate-spin" : ""}`} />
          {scanning ? "Scanning..." : "Rescan Library"}
        </button>
      </div>

      {stats && (
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-gray-100 dark:bg-gray-800 p-4 rounded-lg">
            <div className="text-2xl font-bold">{stats.trackCount}</div>
            <div className="text-sm text-gray-600 dark:text-gray-400">Tracks</div>
          </div>
          <div className="bg-gray-100 dark:bg-gray-800 p-4 rounded-lg">
            <div className="text-2xl font-bold">{formatSize(stats.totalSize)}</div>
            <div className="text-sm text-gray-600 dark:text-gray-400">Total Size</div>
          </div>
          <div className="bg-gray-100 dark:bg-gray-800 p-4 rounded-lg">
            <div className="text-2xl font-bold">
              {stats.lastScanned ? new Date(stats.lastScanned).toLocaleDateString() : "Never"}
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-400">Last Scanned</div>
          </div>
        </div>
      )}

      <form onSubmit={handleSearch} className="flex gap-2 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by title, artist, or album..."
            className="w-full pl-10 pr-4 py-2 border rounded-lg"
          />
        </div>
        <button type="submit" className="px-4 py-2 bg-gray-200 dark:bg-gray-700 rounded-lg">
          Search
        </button>
        {search && (
          <button
            type="button"
            onClick={() => {
              setSearch("");
              fetchTracks();
            }}
            className="px-4 py-2 text-gray-600 hover:underline"
          >
            Clear
          </button>
        )}
      </form>

      <div className="border rounded-lg overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 dark:bg-gray-800">
            <tr>
              <th className="text-left p-3">Title</th>
              <th className="text-left p-3">Artist</th>
              <th className="text-left p-3">Album</th>
              <th className="text-left p-3">Duration</th>
              <th className="text-left p-3">Path</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="p-4 text-center text-gray-500">
                  Loading...
                </td>
              </tr>
            ) : tracks.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-4 text-center text-gray-500">
                  No tracks found
                </td>
              </tr>
            ) : (
              tracks.map((track) => (
                <tr key={track.id} className="border-t hover:bg-gray-50 dark:hover:bg-gray-800">
                  <td className="p-3 font-medium">
                    <div className="flex items-center gap-2">
                      <Music className="w-4 h-4 text-gray-400" />
                      {track.title || "Unknown"}
                    </div>
                  </td>
                  <td className="p-3 text-gray-600 dark:text-gray-400">
                    {track.artist || "Unknown"}
                  </td>
                  <td className="p-3 text-gray-600 dark:text-gray-400">
                    {track.album || "-"}
                  </td>
                  <td className="p-3 text-gray-600 dark:text-gray-400">
                    {formatDuration(track.duration_s)}
                  </td>
                  <td className="p-3 text-xs text-gray-500 font-mono truncate max-w-xs" title={track.file_path}>
                    {track.file_path.split("/").slice(-3).join("/")}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}