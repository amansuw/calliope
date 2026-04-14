"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, ListMusic } from "lucide-react";
import { PlaylistCard } from "@/components/playlist-card";

interface Playlist {
  id: string;
  url: string;
  source: string;
  name: string | null;
  enabled: number;
  last_checked: string | null;
  new_tracks_count: number;
  track_ids: string | null;
}

export default function PlaylistsPage() {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPlaylists = useCallback(async () => {
    const res = await fetch("/api/playlists");
    const data = await res.json();
    setPlaylists(data.playlists || []);
  }, []);

  useEffect(() => {
    fetchPlaylists();
  }, [fetchPlaylists]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim() || adding) return;

    setAdding(true);
    setError(null);

    try {
      const res = await fetch("/api/playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to add playlist");
      }

      setUrl("");
      fetchPlaylists();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setAdding(false);
    }
  }

  async function handleToggle(id: string, enabled: boolean) {
    await fetch(`/api/playlists/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    fetchPlaylists();
  }

  async function handleDelete(id: string) {
    await fetch(`/api/playlists/${id}`, { method: "DELETE" });
    fetchPlaylists();
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Monitored Playlists</h1>
      <p className="text-sm text-muted-fg">
        Playlists are checked every 6 hours for new tracks. New songs are
        automatically downloaded with default settings.
      </p>

      {/* Add form */}
      <form onSubmit={handleAdd} className="flex gap-2">
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Paste a Spotify or YouTube playlist URL..."
          className="flex-1 rounded-lg border border-border bg-card px-4 py-2.5 text-sm text-fg placeholder:text-muted-fg focus:border-primary focus:outline-none"
        />
        <button
          type="submit"
          disabled={!url.trim() || adding}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-fg disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          Monitor
        </button>
      </form>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      {/* Playlist list */}
      <div className="space-y-3">
        {playlists.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-12 text-muted-fg">
            <ListMusic className="h-12 w-12 opacity-30" />
            <p className="text-sm">No monitored playlists</p>
          </div>
        ) : (
          playlists.map((p) => (
            <PlaylistCard
              key={p.id}
              playlist={p}
              onToggle={handleToggle}
              onDelete={handleDelete}
            />
          ))
        )}
      </div>
    </div>
  );
}
