"use client";

import {
  Check,
  AlertCircle,
  SkipForward,
  Loader2,
  Music,
  AlertTriangle,
} from "lucide-react";

interface Track {
  id: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  status: string;
  progress: number;
  error: string | null;
  confidence: string | null;
  lyrics_synced: number;
}

export function TrackRow({ track }: { track: Track }) {
  const statusIcon = () => {
    switch (track.status) {
      case "done":
        return <Check className="h-4 w-4 text-success" />;
      case "error":
        return <AlertCircle className="h-4 w-4 text-destructive" />;
      case "skipped":
        return <SkipForward className="h-4 w-4 text-warning" />;
      case "downloading":
      case "converting":
      case "moving":
        return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
      default:
        return <Music className="h-4 w-4 text-muted-fg" />;
    }
  };

  return (
    <div className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-secondary/50">
      <div className="flex-shrink-0">{statusIcon()}</div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {track.title || "Resolving..."}
        </p>
        <p className="truncate text-xs text-muted-fg">
          {track.artist || ""}
          {track.album ? ` · ${track.album}` : ""}
        </p>
      </div>

      {track.confidence === "low" && (
        <span title="Low confidence match" className="flex-shrink-0">
          <AlertTriangle className="h-3.5 w-3.5 text-warning" />
        </span>
      )}

      {track.lyrics_synced === 1 && (
        <span className="text-[10px] rounded bg-primary/20 text-primary px-1.5 py-0.5 flex-shrink-0">
          LRC
        </span>
      )}

      {(track.status === "downloading" ||
        track.status === "converting" ||
        track.status === "moving") && (
        <div className="w-20 flex-shrink-0">
          <div className="h-1.5 rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${track.progress}%` }}
            />
          </div>
          <p className="text-[10px] text-muted-fg text-right mt-0.5">
            {track.progress}%
          </p>
        </div>
      )}

      {track.status === "error" && track.error && (
        <span
          className="text-[10px] text-destructive truncate max-w-32"
          title={track.error}
        >
          {track.error}
        </span>
      )}

      {track.status === "skipped" && (
        <span className="text-[10px] text-warning">Skipped</span>
      )}
    </div>
  );
}
