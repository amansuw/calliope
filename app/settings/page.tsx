"use client";

import { useState, useEffect } from "react";
import {
  Check,
  Loader2,
  CheckCircle,
  XCircle,
  FolderOpen,
} from "lucide-react";

interface Settings {
  default_format: string;
  default_quality: string;
  ytdlp_installed: boolean;
  discord_configured: boolean;
  navidrome_configured: boolean;
  temp_dir: string;
  music_dir: string;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [format, setFormat] = useState("mp3");
  const [quality, setQuality] = useState("320");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        setSettings(data);
        setFormat(data.default_format);
        setQuality(data.default_quality);
      })
      .catch(() => {});
  }, []);

  async function handleSave() {
    setSaving(true);
    setSaved(false);

    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        default_format: format,
        default_quality: quality,
      }),
    });

    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  if (!settings) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-fg">
        Loading...
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-2xl">
      <h1 className="text-2xl font-bold">Settings</h1>

      {/* Integration Status */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Integrations</h2>
        <div className="rounded-xl border border-border bg-card divide-y divide-border">
          <IntegrationRow
            label="yt-dlp (Spotify & YouTube)"
            configured={settings.ytdlp_installed}
            hint="Install yt-dlp: pip install yt-dlp"
          />
          <IntegrationRow
            label="Discord Notifications"
            configured={settings.discord_configured}
            hint="Set DISCORD_BOT_TOKEN and DISCORD_CHANNEL_ID in .env"
          />
          <IntegrationRow
            label="Navidrome"
            configured={settings.navidrome_configured}
            hint="Set NAVIDROME_URL, NAVIDROME_USER, NAVIDROME_PASSWORD in .env"
          />
        </div>
      </section>

      {/* Default Format */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Default Download Format</h2>
        <div className="rounded-xl border border-border bg-card p-4 space-y-4">
          <div>
            <label className="text-sm text-muted-fg mb-2 block">
              Format
            </label>
            <div className="flex rounded-lg border border-border overflow-hidden w-fit">
              {["mp3", "opus", "flac"].map((f) => (
                <button
                  key={f}
                  onClick={() => setFormat(f)}
                  className={`px-4 py-2 text-sm font-medium transition-colors ${
                    format === f
                      ? "bg-primary text-primary-fg"
                      : "bg-card text-muted-fg hover:text-fg"
                  }`}
                >
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {format !== "flac" && (
            <div>
              <label className="text-sm text-muted-fg mb-2 block">
                Quality
              </label>
              <select
                value={quality}
                onChange={(e) => setQuality(e.target.value)}
                className="rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg focus:outline-none"
              >
                <option value="128">128 kbps</option>
                <option value="192">192 kbps</option>
                <option value="256">256 kbps</option>
                <option value="320">320 kbps</option>
              </select>
            </div>
          )}

          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-fg disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : saved ? (
              <Check className="h-4 w-4" />
            ) : null}
            {saved ? "Saved" : "Save Defaults"}
          </button>
        </div>
      </section>

      {/* Paths */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Paths</h2>
        <div className="rounded-xl border border-border bg-card divide-y divide-border">
          <PathRow label="Temp Downloads" path={settings.temp_dir} />
          <PathRow label="Music Library" path={settings.music_dir} />
        </div>
        <p className="text-xs text-muted-fg mt-2">
          Paths are configured via environment variables.
        </p>
      </section>
    </div>
  );
}

function IntegrationRow({
  label,
  configured,
  hint,
}: {
  label: string;
  configured: boolean;
  hint: string;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      {configured ? (
        <CheckCircle className="h-4 w-4 text-success flex-shrink-0" />
      ) : (
        <XCircle className="h-4 w-4 text-muted-fg flex-shrink-0" />
      )}
      <div className="flex-1">
        <p className="text-sm font-medium">{label}</p>
        {!configured && (
          <p className="text-xs text-muted-fg">{hint}</p>
        )}
      </div>
      <span
        className={`text-xs px-2 py-0.5 rounded-full ${
          configured
            ? "bg-success/10 text-success"
            : "bg-secondary text-muted-fg"
        }`}
      >
        {configured ? "Active" : "Not Set"}
      </span>
    </div>
  );
}

function PathRow({ label, path }: { label: string; path: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <FolderOpen className="h-4 w-4 text-muted-fg flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-fg truncate font-mono">
          {path}
        </p>
      </div>
    </div>
  );
}
