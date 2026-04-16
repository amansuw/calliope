import { NextRequest, NextResponse } from "next/server";
import { validatePath, savePath, getTempDir, getMusicDir, isConfigured } from "@/lib/config";
import { writeEnvFile } from "@/lib/env";
import { execSync } from "child_process";

function checkYtdlp(): boolean {
  try {
    execSync("yt-dlp --version", { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export async function GET() {
  return NextResponse.json({
    temp_dir: getTempDir(),
    music_dir: getMusicDir(),
    ytdlp_installed: checkYtdlp(),
  });
}

export async function HEAD() {
  const configured = isConfigured();
  return NextResponse.json({ configured }, { status: configured ? 200 : 404 });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { temp_dir, music_dir, discord_bot_token, discord_channel_id, navidrome_url, navidrome_user, navidrome_password } = body;

  const errors: Record<string, string> = {};

  if (temp_dir) {
    const tempValidation = validatePath(temp_dir);
    if (!tempValidation.valid) {
      errors.temp_dir = tempValidation.error || "Invalid temp directory";
    }
  }

  if (music_dir) {
    const musicValidation = validatePath(music_dir);
    if (!musicValidation.valid) {
      errors.music_dir = musicValidation.error || "Invalid music directory";
    }
  }

  if (Object.keys(errors).length > 0) {
    return NextResponse.json({ success: false, errors }, { status: 400 });
  }

  if (temp_dir) {
    const result = savePath("temp_dir", temp_dir);
    if (!result.success) {
      errors.temp_dir = result.error || "Failed to save temp directory";
    }
  }

  if (music_dir) {
    const result = savePath("music_dir", music_dir);
    if (!result.success) {
      errors.music_dir = result.error || "Failed to save music directory";
    }
  }

  const envUpdates: Record<string, string> = {};
  if (discord_bot_token) envUpdates.DISCORD_BOT_TOKEN = discord_bot_token;
  if (discord_channel_id) envUpdates.DISCORD_CHANNEL_ID = discord_channel_id;
  if (navidrome_url) envUpdates.NAVIDROME_URL = navidrome_url;
  if (navidrome_user) envUpdates.NAVIDROME_USER = navidrome_user;
  if (navidrome_password) envUpdates.NAVIDROME_PASSWORD = navidrome_password;

  if (Object.keys(envUpdates).length > 0) {
    const envResult = writeEnvFile(envUpdates);
    if (!envResult.success) {
      errors.env = envResult.error || "Failed to write .env file";
    }
  }

  if (Object.keys(errors).length > 0) {
    return NextResponse.json({ success: false, errors }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}