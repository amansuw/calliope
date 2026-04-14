"use client";

import { useState, useCallback } from "react";
import { Search, X } from "lucide-react";

interface SearchBarProps {
  onSearch: (query: string) => void;
}

export function SearchBar({ onSearch }: SearchBarProps) {
  const [query, setQuery] = useState("");

  const handleChange = useCallback(
    (value: string) => {
      setQuery(value);
      // Debounced search
      const timeout = setTimeout(() => {
        onSearch(value);
      }, 300);
      return () => clearTimeout(timeout);
    },
    [onSearch]
  );

  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-fg" />
      <input
        type="text"
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="Search download history..."
        className="w-full rounded-lg border border-border bg-card pl-10 pr-8 py-2 text-sm text-fg placeholder:text-muted-fg focus:border-primary focus:outline-none"
      />
      {query && (
        <button
          onClick={() => {
            setQuery("");
            onSearch("");
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-muted-fg hover:text-fg"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
