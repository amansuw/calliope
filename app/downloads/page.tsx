"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { UrlInput } from "@/components/url-input";
import { JobCard } from "@/components/job-card";
import { SearchBar } from "@/components/search-bar";
import { Music, Check } from "lucide-react";

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

interface SearchResult {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  final_path: string | null;
}

export default function DownloadsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(
    null
  );
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/jobs?limit=50");
      const data = await res.json();
      setJobs(data.jobs || []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchJobs();

    const scheduleRefresh = () => {
      if (refreshTimeoutRef.current) return;
      refreshTimeoutRef.current = setTimeout(() => {
        refreshTimeoutRef.current = null;
        fetchJobs();
      }, 250);
    };

    const source = new EventSource("/api/events");
    source.addEventListener("connected", scheduleRefresh);
    source.addEventListener("job:update", scheduleRefresh);
    source.addEventListener("track:new", scheduleRefresh);
    source.addEventListener("track:update", scheduleRefresh);
    source.addEventListener("track:progress", scheduleRefresh);
    source.onmessage = scheduleRefresh;

    return () => {
      source.close();
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }
    };
  }, [fetchJobs]);

  async function handleSubmit(urls: string, format: string, quality: string) {
    const res = await fetch("/api/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls, format, quality }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || "Failed to add URLs");
    }
    fetchJobs();
  }

  async function handleDelete(id: string) {
    await fetch(`/api/jobs/${id}`, { method: "DELETE" });
    fetchJobs();
  }

  async function handleSearch(query: string) {
    if (!query.trim()) {
      setSearchResults(null);
      return;
    }
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      setSearchResults(data.tracks || []);
    } catch {
      setSearchResults([]);
    }
  }

  const activeJobs = jobs.filter((j) => !["done", "error"].includes(j.status));
  const completedJobs = jobs.filter((j) => ["done", "error"].includes(j.status));

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-bold mb-4">Download Music</h1>
        <UrlInput onSubmit={handleSubmit} />
      </section>

      {activeJobs.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
            Active Downloads
          </h2>
          <div className="space-y-3">
            {activeJobs.map((job) => (
              <JobCard key={job.id} job={job} onDelete={handleDelete} />
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="text-lg font-semibold mb-3">History</h2>
        <SearchBar onSearch={handleSearch} />

        {searchResults !== null && (
          <div className="mt-3 space-y-1">
            {searchResults.length === 0 ? (
              <p className="text-sm text-muted-fg py-4 text-center">
                No results found
              </p>
            ) : (
              searchResults.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-secondary/50"
                >
                  <Check className="h-4 w-4 text-success flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{t.title}</p>
                    <p className="text-xs text-muted-fg truncate">
                      {t.artist}
                      {t.album ? ` · ${t.album}` : ""}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {searchResults === null && (
          <div className="mt-3 space-y-3">
            {completedJobs.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-12 text-muted-fg">
                <Music className="h-12 w-12 opacity-30" />
                <p className="text-sm">No downloads yet</p>
              </div>
            ) : (
              completedJobs.map((job) => (
                <JobCard key={job.id} job={job} onDelete={handleDelete} />
              ))
            )}
          </div>
        )}
      </section>
    </div>
  );
}
