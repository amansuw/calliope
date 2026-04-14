"use client";

import { useState } from "react";
import {
  Trash2,
  ListMusic,
  Clock,
  ExternalLink,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Loader2,
  CircleDot,
} from "lucide-react";

interface Playlist {
  id: string;
  url: string;
  source: string;
  name: string | null;
  enabled: number;
  last_checked: string | null;
  new_tracks_count: number;
  track_ids: string | null;
  tracks?: PlaylistTrack[];
}

interface PlaylistTrack {
  source_id: string;
  track_id: string | null;
  title: string | null;
  artist: string | null;
  album: string | null;
  status: string;
  progress: number;
  error: string | null;
}

export function PlaylistCard({
  playlist,
  onToggle,
  onScan,
  onDelete,
  isBusy = false,
}: {
  playlist: Playlist;
  onToggle: (id: string, enabled: boolean) => void;
  onScan: (id: string) => void;
  onDelete: (id: string) => void;
  isBusy?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const trackCount = (() => {
    if (!playlist.track_ids) return 0;
    try {
      const parsed = JSON.parse(playlist.track_ids);
      return Array.isArray(parsed) ? parsed.length : 0;
    } catch {
      return 0;
    }
  })();
  const playlistTracks = playlist.tracks || [];

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center gap-4 px-4 py-3">
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
          <button
            onClick={() => setExpanded((v) => !v)}
            className="p-1.5 rounded-lg hover:bg-secondary text-muted-fg transition-transform active:scale-95"
            title={expanded ? "Hide tracks" : "Show tracks"}
          >
            {expanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>

          <a
            href={playlist.url}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 rounded-lg hover:bg-secondary text-muted-fg"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>

          <button
            onClick={() => onToggle(playlist.id, !playlist.enabled)}
            disabled={isBusy}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              playlist.enabled ? "bg-primary" : "bg-secondary"
            } ${isBusy ? "opacity-60" : ""}`}
          >
            <span
              className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                playlist.enabled ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>

          <button
            onClick={() => onScan(playlist.id)}
            disabled={isBusy}
            className={`p-1.5 rounded-lg hover:bg-secondary text-muted-fg transition-transform active:scale-95 ${
              isBusy ? "opacity-60 cursor-not-allowed" : ""
            }`}
            title="Scan now"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isBusy ? "animate-spin" : ""}`} />
          </button>

          <button
            onClick={() => onDelete(playlist.id)}
            disabled={isBusy}
            className={`p-1.5 rounded-lg hover:bg-destructive/10 text-muted-fg hover:text-destructive transition-transform active:scale-95 ${
              isBusy ? "opacity-60 cursor-not-allowed" : ""
            }`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border px-4 py-2">
          {playlistTracks.length === 0 ? (
            <p className="text-xs text-muted-fg py-2">No tracks discovered yet.</p>
          ) : (
            <div className="max-h-64 overflow-auto divide-y divide-border">
              {playlistTracks.map((t) => {
                const { icon, label, cls } = getStatusMeta(t.status);
                const name = t.title || t.source_id;
                return (
                  <div key={t.source_id} className="py-2 flex items-center gap-3">
                    <span className={cls}>{icon}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-fg truncate">{name}</p>
                      <p className="text-[11px] text-muted-fg truncate">
                        {t.artist || "Unknown Artist"}
                        {t.album ? ` · ${t.album}` : ""}
                      </p>
                    </div>
                    <div className="text-[11px] text-muted-fg text-right">
                      <p>{label}</p>
                      {t.status === "downloading" && (
                        <p>{Math.max(0, Math.min(100, t.progress || 0))}%</p>
                      )}
                      {t.error && (
                        <p className="text-destructive truncate max-w-44">{t.error}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function getStatusMeta(status: string): {
  icon: React.ReactNode;
  label: string;
  cls: string;
} {
  if (status === "done") {
    return {
      icon: <CheckCircle2 className="h-3.5 w-3.5" />,
      label: "Downloaded",
      cls: "text-green-500",
    };
  }
  if (status === "error") {
    return {
      icon: <XCircle className="h-3.5 w-3.5" />,
      label: "Failed",
      cls: "text-destructive",
    };
  }
  if (["downloading", "converting", "moving", "resolving", "pending"].includes(status)) {
    return {
      icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
      label: status[0].toUpperCase() + status.slice(1),
      cls: "text-primary",
    };
  }
  if (status === "skipped") {
    return {
      icon: <CircleDot className="h-3.5 w-3.5" />,
      label: "Skipped",
      cls: "text-yellow-500",
    };
  }
  return {
    icon: <CircleDot className="h-3.5 w-3.5" />,
    label: "Not downloaded",
    cls: "text-muted-fg",
  };
}
