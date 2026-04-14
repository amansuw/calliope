"use client";

interface FormatSelectorProps {
  format: string;
  quality: string;
  onFormatChange: (f: string) => void;
  onQualityChange: (q: string) => void;
}

const formats = [
  { value: "mp3", label: "MP3" },
  { value: "opus", label: "OPUS" },
  { value: "flac", label: "FLAC" },
];

const qualities = [
  { value: "128", label: "128k" },
  { value: "192", label: "192k" },
  { value: "256", label: "256k" },
  { value: "320", label: "320k" },
];

export function FormatSelector({
  format,
  quality,
  onFormatChange,
  onQualityChange,
}: FormatSelectorProps) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex rounded-lg border border-border overflow-hidden">
        {formats.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => onFormatChange(f.value)}
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${
              format === f.value
                ? "bg-primary text-primary-fg"
                : "bg-card text-muted-fg hover:text-fg"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {format !== "flac" && (
        <select
          value={quality}
          onChange={(e) => onQualityChange(e.target.value)}
          className="rounded-lg border border-border bg-card px-2 py-1.5 text-xs text-fg focus:outline-none"
        >
          {qualities.map((q) => (
            <option key={q.value} value={q.value}>
              {q.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
