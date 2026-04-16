"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Loader2,
  FolderOpen,
  AlertCircle,
  CheckCircle,
  XCircle,
  ChevronRight,
  ChevronLeft,
  Music,
  Settings,
  Bell,
  HardDrive,
} from "lucide-react";

interface PathValidation {
  valid: boolean;
  exists: boolean;
  writable: boolean;
  error?: string;
}

interface SetupData {
  temp_dir: string;
  music_dir: string;
  temp_dir_valid?: PathValidation;
  music_dir_valid?: PathValidation;
  ytdlp_installed: boolean;
}

export default function SetupPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<SetupData>({
    temp_dir: "./downloads",
    music_dir: "./music",
    ytdlp_installed: false,
  });
  const [validation, setValidation] = useState<{
    temp_dir?: PathValidation;
    music_dir?: PathValidation;
  }>({});
  const [integrations, setIntegrations] = useState({
    discord_bot_token: "",
    discord_channel_id: "",
    navidrome_url: "",
    navidrome_user: "",
    navidrome_password: "",
  });
  const [envError, setEnvError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/setup")
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        if (d.temp_dir && d.music_dir) {
          validatePath("temp_dir", d.temp_dir);
          validatePath("music_dir", d.music_dir);
        }
      })
      .catch(() => {});
  }, []);

  async function validatePath(field: "temp_dir" | "music_dir", value: string) {
    try {
      const res = await fetch("/api/setup/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: value }),
      });
      const result = await res.json();
      setValidation((prev) => ({ ...prev, [field]: result }));
    } catch {
      setValidation((prev) => ({
        ...prev,
        [field]: { valid: false, exists: false, writable: false, error: "Validation failed" },
      }));
    }
  }

  function handleTempDirChange(value: string) {
    setData((d) => ({ ...d, temp_dir: value }));
    setValidation((v) => ({ ...v, temp_dir: undefined }));
  }

  function handleMusicDirChange(value: string) {
    setData((d) => ({ ...d, music_dir: value }));
    setValidation((v) => ({ ...v, music_dir: undefined }));
  }

  async function handleNext() {
    if (step === 1) {
      if (!validation.temp_dir?.valid) {
        await validatePath("temp_dir", data.temp_dir);
      }
      if (!validation.music_dir?.valid) {
        await validatePath("music_dir", data.music_dir);
      }
      if (!validation.temp_dir?.valid || !validation.music_dir?.valid) {
        return;
      }
    }
    setStep(step + 1);
  }

  async function handleFinish() {
    setSaving(true);
    setEnvError(null);

    try {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          temp_dir: data.temp_dir,
          music_dir: data.music_dir,
          ...integrations,
        }),
      });
      const result = await res.json();

      if (!result.success) {
        if (result.errors?.env) {
          setEnvError(result.errors.env);
        } else {
          setEnvError("Failed to save configuration");
        }
        setSaving(false);
        return;
      }

      router.push("/");
    } catch {
      setEnvError("Failed to save configuration");
      setSaving(false);
    }
  }

  const canProceed =
    step === 1
      ? validation.temp_dir?.valid && validation.music_dir?.valid
      : true;

  return (
    <div className="min-h-screen bg-bg text-fg flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
            <Music className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold">Welcome to Calliope</h1>
          <p className="text-muted-fg mt-2">
            Let&apos;s get your music downloader set up
          </p>
        </div>

        <div className="flex items-center justify-center gap-2 mb-8">
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              className={`w-3 h-3 rounded-full transition-colors ${
                step >= s ? "bg-primary" : "bg-border"
              }`}
            />
          ))}
        </div>

        <div className="rounded-xl border border-border bg-card p-6">
          {step === 1 && (
            <div className="space-y-6">
              <div className="flex items-center gap-3 mb-4">
                <HardDrive className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-semibold">Storage Paths</h2>
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">
                  Temp Downloads Directory
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={data.temp_dir}
                    onChange={(e) => handleTempDirChange(e.target.value)}
                    onBlur={() => validatePath("temp_dir", data.temp_dir)}
                    className="w-full rounded-lg border border-border bg-bg px-4 py-2.5 pr-10 text-fg focus:outline-none focus:ring-2 focus:ring-primary/50"
                    placeholder="./downloads"
                  />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    {validation.temp_dir?.valid ? (
                      <CheckCircle className="h-5 w-5 text-success" />
                    ) : validation.temp_dir?.valid === false ? (
                      <XCircle className="h-5 w-5 text-error" />
                    ) : null}
                  </div>
                </div>
                {validation.temp_dir?.error && (
                  <p className="text-xs text-error mt-1">
                    {validation.temp_dir.error}
                  </p>
                )}
                <p className="text-xs text-muted-fg mt-1">
                  Where temporary download files are stored
                </p>
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">
                  Music Library Directory
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={data.music_dir}
                    onChange={(e) => handleMusicDirChange(e.target.value)}
                    onBlur={() => validatePath("music_dir", data.music_dir)}
                    className="w-full rounded-lg border border-border bg-bg px-4 py-2.5 pr-10 text-fg focus:outline-none focus:ring-2 focus:ring-primary/50"
                    placeholder="./music"
                  />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    {validation.music_dir?.valid ? (
                      <CheckCircle className="h-5 w-5 text-success" />
                    ) : validation.music_dir?.valid === false ? (
                      <XCircle className="h-5 w-5 text-error" />
                    ) : null}
                  </div>
                </div>
                {validation.music_dir?.error && (
                  <p className="text-xs text-error mt-1">
                    {validation.music_dir.error}
                  </p>
                )}
                <p className="text-xs text-muted-fg mt-1">
                  Where your music files will be organized
                </p>
              </div>

              {!data.ytdlp_installed && (
                <div className="flex items-start gap-3 p-3 rounded-lg bg-warning/10 border border-warning/30">
                  <AlertCircle className="h-5 w-5 text-warning flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium">yt-dlp not found</p>
                    <p className="text-xs text-muted-fg mt-1">
                      Install with: pip install yt-dlp
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6">
              <div className="flex items-center gap-3 mb-4">
                <Settings className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-semibold">Optional Integrations</h2>
              </div>

              <p className="text-sm text-muted-fg">
                Configure these if you want additional features. You can always
                add them later in Settings.
              </p>

              <div className="space-y-4">
                <div className="p-4 rounded-lg border border-border bg-bg">
                  <div className="flex items-center gap-2 mb-3">
                    <Bell className="h-4 w-4 text-muted-fg" />
                    <h3 className="text-sm font-medium">Discord Notifications</h3>
                  </div>
                  <div className="space-y-3">
                    <input
                      type="password"
                      value={integrations.discord_bot_token}
                      onChange={(e) =>
                        setIntegrations((i) => ({
                          ...i,
                          discord_bot_token: e.target.value,
                        }))
                      }
                      className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-fg focus:outline-none"
                      placeholder="Bot Token"
                    />
                    <input
                      type="text"
                      value={integrations.discord_channel_id}
                      onChange={(e) =>
                        setIntegrations((i) => ({
                          ...i,
                          discord_channel_id: e.target.value,
                        }))
                      }
                      className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-fg focus:outline-none"
                      placeholder="Channel ID"
                    />
                  </div>
                </div>

                <div className="p-4 rounded-lg border border-border bg-bg">
                  <div className="flex items-center gap-2 mb-3">
                    <HardDrive className="h-4 w-4 text-muted-fg" />
                    <h3 className="text-sm font-medium">Navidrome (Media Server)</h3>
                  </div>
                  <div className="space-y-3">
                    <input
                      type="text"
                      value={integrations.navidrome_url}
                      onChange={(e) =>
                        setIntegrations((i) => ({
                          ...i,
                          navidrome_url: e.target.value,
                        }))
                      }
                      className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-fg focus:outline-none"
                      placeholder="http://localhost:4533"
                    />
                    <div className="grid grid-cols-2 gap-3">
                      <input
                        type="text"
                        value={integrations.navidrome_user}
                        onChange={(e) =>
                          setIntegrations((i) => ({
                            ...i,
                            navidrome_user: e.target.value,
                          }))
                        }
                        className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-fg focus:outline-none"
                        placeholder="Username"
                      />
                      <input
                        type="password"
                        value={integrations.navidrome_password}
                        onChange={(e) =>
                          setIntegrations((i) => ({
                            ...i,
                            navidrome_password: e.target.value,
                          }))
                        }
                        className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-fg focus:outline-none"
                        placeholder="Password"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6">
              <div className="text-center">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-success/10 mb-4">
                  <CheckCircle className="h-8 w-8 text-success" />
                </div>
                <h2 className="text-lg font-semibold">Ready to Go!</h2>
                <p className="text-sm text-muted-fg mt-2">
                  Your configuration has been saved. Click Finish to start using
                  Calliope.
                </p>
              </div>

              <div className="rounded-lg border border-border bg-bg p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-fg">Temp Directory</span>
                  <span className="font-mono text-xs truncate max-w-[200px]">
                    {data.temp_dir}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-fg">Music Directory</span>
                  <span className="font-mono text-xs truncate max-w-[200px]">
                    {data.music_dir}
                  </span>
                </div>
                {integrations.discord_bot_token && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-fg">Discord</span>
                    <span className="text-success text-xs">Enabled</span>
                  </div>
                )}
                {integrations.navidrome_url && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-fg">Navidrome</span>
                    <span className="text-success text-xs">Enabled</span>
                  </div>
                )}
              </div>

              {envError && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-error/10 border border-error/30 text-sm text-error">
                  <AlertCircle className="h-4 w-4 flex-shrink-0" />
                  {envError}
                </div>
              )}
            </div>
          )}

          <div className="flex justify-between mt-8">
            {step > 1 ? (
              <button
                onClick={() => setStep(step - 1)}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-muted-fg hover:text-fg"
              >
                <ChevronLeft className="h-4 w-4" />
                Back
              </button>
            ) : (
              <div />
            )}

            {step < 3 ? (
              <button
                onClick={handleNext}
                disabled={!canProceed}
                className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-fg disabled:opacity-50"
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </button>
            ) : (
              <button
                onClick={handleFinish}
                disabled={saving}
                className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-fg disabled:opacity-50"
              >
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4" />
                    Finish
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}