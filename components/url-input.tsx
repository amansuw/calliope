"use client";

import { useState } from "react";
import { Send, Loader2 } from "lucide-react";
import { FormatSelector } from "./format-selector";

interface UrlInputProps {
  onSubmit: (urls: string, format: string, quality: string) => Promise<void>;
}

export function UrlInput({ onSubmit }: UrlInputProps) {
  const [urls, setUrls] = useState("");
  const [format, setFormat] = useState("mp3");
  const [quality, setQuality] = useState("320");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lineCount = urls
    .split("\n")
    .filter((l) => l.trim()).length;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!urls.trim() || loading) return;

    setLoading(true);
    setError(null);

    try {
      await onSubmit(urls, format, quality);
      setUrls("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="relative">
        <textarea
          value={urls}
          onChange={(e) => setUrls(e.target.value)}
          placeholder="Paste Spotify or YouTube Music URLs (one per line)..."
          rows={3}
          className="w-full resize-none rounded-xl border border-border bg-card px-4 py-3 text-sm text-fg placeholder:text-muted-fg focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
        {lineCount > 0 && (
          <span className="absolute right-3 top-3 rounded-full bg-primary/20 px-2 py-0.5 text-xs text-primary">
            {lineCount} URL{lineCount !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <FormatSelector
          format={format}
          quality={quality}
          onFormatChange={setFormat}
          onQualityChange={setQuality}
        />

        <button
          type="submit"
          disabled={!urls.trim() || loading}
          className="ml-auto flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-fg transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          Download
        </button>
      </div>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}
    </form>
  );
}
