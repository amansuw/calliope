"use client";

import { Trash2, ListMusic, Clock, ExternalLink } from "lucide-react";

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

export function PlaylistCard({
  playlist,
  onToggle,
  onDelete,
}: {
  playlist: Playlist;
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
}) {
  const trackCount = playlist.track_ids
    ? JSON.parse(playlist.track_ids).length
    : 0;

  return (
    <div className="flex items-center gap-4 rounded-xl border border-border bg-card px-4 py-3">
      <ListMusic
        className={`h-5 w-5 flex-shrink-0 ${
          playlist.source === "spotify" ? "text-green-500" : "text-red-500"
        }`}
      />

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">
          {playlist.name || "Unnamed Playlist"}
        </p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-fg">
          <span className="capitalize">{playlist.source}</span>
          <span>·</span>
          <span>{trackCount} tracks</span>
          {playlist.last_checked && (
            <>
              <span>·</span>
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {new Date(playlist.last_checked).toLocaleDateString()}
              </span>
            </>
          )}
          {playlist.new_tracks_count > 0 && (
            <span className="rounded-full bg-primary/20 text-primary px-2 py-0.5">
              +{playlist.new_tracks_count} new
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        <a
          href={playlist.url}
          target="_blank"
          rel="noopener noreferrer"
          className="p-1.5 rounded-lg hover:bg-secondary text-muted-fg"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>

        {/* Toggle switch */}
        <button
          onClick={() => onToggle(playlist.id, !playlist.enabled)}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            playlist.enabled
              ? "bg-primary"
              : "bg-secondary"
          }`}
        >
          <span
            className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
              playlist.enabled ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>

        <button
          onClick={() => onDelete(playlist.id)}
          className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-fg hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
