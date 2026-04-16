import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";
import { getSetting, setSetting } from "@/lib/db";
import { getTempDir, getMusicDir, validatePath, savePath } from "@/lib/config";

function checkYtdlp(): boolean {
  try {
    execSync("yt-dlp --version", { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export async function GET() {
  const tempDir = getTempDir();
  const musicDir = getMusicDir();
  const tempValidation = validatePath(tempDir);
  const musicValidation = validatePath(musicDir);

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
    temp_dir: tempDir,
    temp_dir_verified: tempValidation.valid,
    music_dir: musicDir,
    music_dir_verified: musicValidation.valid,
  };

  return NextResponse.json(settings);
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { default_format, default_quality, temp_dir, music_dir } = body;

  const errors: Record<string, string> = {};

  if (temp_dir !== undefined) {
    const validation = validatePath(temp_dir);
    if (!validation.valid) {
      errors.temp_dir = validation.error || "Invalid path";
    } else {
      savePath("temp_dir", temp_dir);
    }
  }

  if (music_dir !== undefined) {
    const validation = validatePath(music_dir);
    if (!validation.valid) {
      errors.music_dir = validation.error || "Invalid path";
    } else {
      savePath("music_dir", music_dir);
    }
  }

  const allowedKeys = ["default_format", "default_quality"];
  for (const [key, value] of Object.entries(body)) {
    if (allowedKeys.includes(key) && typeof value === "string") {
      setSetting(key, value);
    }
  }

  if (Object.keys(errors).length > 0) {
    return NextResponse.json({ ok: false, errors }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}