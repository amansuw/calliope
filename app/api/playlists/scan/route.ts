import { NextResponse } from "next/server";
import { runAllPlaylistsNow } from "@/lib/cron";
import { ensureRuntimeStarted } from "@/lib/runtime";

export async function POST() {
  ensureRuntimeStarted();
  await runAllPlaylistsNow();
  return NextResponse.json({ ok: true });
}
