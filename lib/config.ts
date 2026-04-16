import fs from "fs";
import path from "path";
import { getSetting, setSetting } from "./db";

const DEFAULT_TEMP_DIR = "./downloads";
const DEFAULT_MUSIC_DIR = "./music";

export function getTempDir(): string {
  return (
    getSetting("temp_dir") ||
    process.env.TEMP_DOWNLOAD_DIR ||
    DEFAULT_TEMP_DIR
  );
}

export function getMusicDir(): string {
  return (
    getSetting("music_dir") ||
    process.env.MUSIC_LIBRARY_DIR ||
    DEFAULT_MUSIC_DIR
  );
}

export function getDefaultFormat(): string {
  return getSetting("default_format") || "mp3";
}

export function getDefaultQuality(): string {
  return getSetting("default_quality") || "320";
}

export function getDiscordToken(): string | undefined {
  return process.env.DISCORD_BOT_TOKEN;
}

export function getDiscordChannel(): string | undefined {
  return process.env.DISCORD_CHANNEL_ID;
}

export function getNavidromeConfig(): {
  url?: string;
  user?: string;
  password?: string;
} {
  return {
    url: process.env.NAVIDROME_URL,
    user: process.env.NAVIDROME_USER,
    password: process.env.NAVIDROME_PASSWORD,
  };
}

export function getSpotifyScraperCmd(): string {
  return process.env.SPOTIFY_SCRAPER_CMD || "spotify-scraper";
}

export function getYtdlpCookiesFile(): string | undefined {
  return process.env.YTDLP_COOKIES_FILE?.trim();
}

export function getYtdlpCookiesFromBrowser(): string | undefined {
  return process.env.YTDLP_COOKIES_FROM_BROWSER?.trim();
}

export interface PathValidation {
  valid: boolean;
  exists: boolean;
  writable: boolean;
  error?: string;
}

export function validatePath(dir: string): PathValidation {
  if (!dir || dir.trim() === "") {
    return { valid: false, exists: false, writable: false, error: "Path is empty" };
  }

  const resolved = path.resolve(dir);

  if (fs.existsSync(resolved)) {
    try {
      const testFile = path.join(resolved, `.calliope-test-${Date.now()}`);
      fs.writeFileSync(testFile, "test");
      fs.unlinkSync(testFile);
      return { valid: true, exists: true, writable: true };
    } catch (err) {
      return {
        valid: false,
        exists: true,
        writable: false,
        error: `Directory exists but is not writable: ${String(err)}`,
      };
    }
  }

  const parentDir = path.dirname(resolved);
  if (fs.existsSync(parentDir)) {
    return {
      valid: true,
      exists: false,
      writable: true,
      error: "Directory does not exist but parent is writable - will be created on first use",
    };
  }

  return {
    valid: false,
    exists: false,
    writable: false,
    error: "Parent directory does not exist",
  };
}

export function savePath(key: string, value: string): { success: boolean; error?: string } {
  const validation = validatePath(value);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }
  setSetting(key, value);
  return { success: true };
}

export function isConfigured(): boolean {
  const tempDir = getTempDir();
  const musicDir = getMusicDir();
  return !!(tempDir && musicDir);
}