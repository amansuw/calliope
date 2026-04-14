"use client";

import { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Trash2,
  ExternalLink,
  Disc3,
  Loader2,
} from "lucide-react";
import { TrackRow } from "./track-row";

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

interface Job {
  id: string;
  url: string;
  source: string;
  type: string;
  status: string;
  format: string;
  quality: string;
  track_count: number;
  created_at: string;
  tracks: Track[];
}

function statusLabel(status: string) {
  const map: Record<string, { text: string; color: string }> = {
    pending: { text: "Pending", color: "text-muted-fg" },
    resolving: { text: "Resolving", color: "text-primary" },
    downloading: { text: "Downloading", color: "text-primary" },
    converting: { text: "Converting", color: "text-primary" },
    moving: { text: "Moving", color: "text-primary" },
    done: { text: "Done", color: "text-success" },
    error: { text: "Error", color: "text-destructive" },
  };
  return map[status] || { text: status, color: "text-muted-fg" };
}

export function JobCard({
  job,
  onDelete,
}: {
  job: Job;
  onDelete: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(
    job.status !== "done" && job.status !== "error"
  );

  const status = statusLabel(job.status);
  const isActive =
    job.status !== "done" && job.status !== "error" && job.status !== "pending";
  const doneTracks = job.tracks.filter((t) => t.status === "done").length;

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-secondary/30"
        onClick={() => setExpanded(!expanded)}
      >
        {isActive ? (
          <Loader2 className="h-5 w-5 animate-spin text-primary flex-shrink-0" />
        ) : (
          <Disc3
            className={`h-5 w-5 flex-shrink-0 ${
              job.source === "spotify"
                ? "text-green-500"
                : "text-red-500"
            }`}
          />
        )}

        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate">
            {job.type === "playlist" ? "Playlist" : "Track"} ·{" "}
            <span className="text-muted-fg">
              {job.source}
            </span>
          </p>
          <div className="flex items-center gap-2 text-xs text-muted-fg">
            <span className={status.color}>{status.text}</span>
            <span>·</span>
            <span>
              {doneTracks}/{job.track_count || "?"} tracks
            </span>
            <span>·</span>
            <span className="uppercase">
              {job.format} {job.format !== "flac" ? job.quality + "k" : ""}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          <a
            href={job.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="p-1.5 rounded-lg hover:bg-secondary text-muted-fg"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(job.id);
            }}
            className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-fg hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-muted-fg" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-fg" />
          )}
        </div>
      </div>

      {expanded && job.tracks.length > 0 && (
        <div className="border-t border-border px-1 py-1 max-h-80 overflow-y-auto">
          {job.tracks.map((track) => (
            <TrackRow key={track.id} track={track} />
          ))}
        </div>
      )}
    </div>
  );
}
