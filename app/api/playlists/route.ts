import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import {
  listMonitoredPlaylists,
  createMonitoredPlaylist,
  getPlaylistTrackStatuses,
} from "@/lib/db";
import { parseUrl } from "@/lib/parser";
import { runPlaylistCheckNow } from "@/lib/cron";
import { ensureRuntimeStarted } from "@/lib/runtime";

export async function GET() {
  ensureRuntimeStarted();
  const playlists = listMonitoredPlaylists().map((playlist) => {
    let sourceIds: string[] = [];
    if (playlist.track_ids) {
      try {
        const parsed = JSON.parse(playlist.track_ids);
        if (Array.isArray(parsed)) {
          sourceIds = parsed.filter((x): x is string => typeof x === "string");
        }
      } catch {
        sourceIds = [];
      }
    }

    return {
      ...playlist,
      tracks: getPlaylistTrackStatuses(playlist.source, sourceIds),
    };
  });
  return NextResponse.json({ playlists });
}

export async function POST(req: NextRequest) {
  try {
    ensureRuntimeStarted();
    const body = await req.json();
    const { url } = body;

    if (!url) {
      return NextResponse.json({ error: "Missing URL" }, { status: 400 });
    }

    const parsed = parseUrl(url);
    if (!parsed || parsed.type !== "playlist") {
      return NextResponse.json(
        { error: "Invalid playlist URL" },
        { status: 400 }
      );
    }

    const id = uuid();
    createMonitoredPlaylist({
      id,
      url: parsed.url,
      source: parsed.source,
      name: null,
      track_ids: null,
    });

    void runPlaylistCheckNow(id);
    return NextResponse.json({ id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
