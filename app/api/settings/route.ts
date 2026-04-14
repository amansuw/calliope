import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";
import { getSetting, setSetting } from "@/lib/db";

function checkYtdlp(): boolean {
  try {
    execSync("yt-dlp --version", { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export async function GET() {
  const settings = {
    default_format: getSetting("default_format") || "mp3",
    default_quality: getSetting("default_quality") || "320",
    ytdlp_installed: checkYtdlp(),
    discord_configured: !!(
      process.env.DISCORD_BOT_TOKEN && process.env.DISCORD_CHANNEL_ID
    ),
    navidrome_configured: !!(
      process.env.NAVIDROME_URL && process.env.NAVIDROME_USER
    ),
    temp_dir: process.env.TEMP_DOWNLOAD_DIR || "/mnt/nvme-ssd/calliope/downloads",
    music_dir: process.env.MUSIC_LIBRARY_DIR || "/mnt/wd-hdd/Media/Music",
  };

  return NextResponse.json(settings);
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();

  const allowedKeys = ["default_format", "default_quality"];
  for (const [key, value] of Object.entries(body)) {
    if (allowedKeys.includes(key) && typeof value === "string") {
      setSetting(key, value);
    }
  }

  return NextResponse.json({ ok: true });
}
