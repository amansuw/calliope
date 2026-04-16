import { NextRequest, NextResponse } from "next/server";
import { isConfigured, getTempDir, getMusicDir } from "@/lib/config";

export async function GET() {
  const configured = isConfigured();
  return NextResponse.json({
    configured,
    temp_dir: configured ? getTempDir() : undefined,
    music_dir: configured ? getMusicDir() : undefined,
  });
}