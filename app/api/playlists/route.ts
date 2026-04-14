import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import {
  listMonitoredPlaylists,
  createMonitoredPlaylist,
} from "@/lib/db";
import { parseUrl } from "@/lib/parser";

export async function GET() {
  const playlists = listMonitoredPlaylists();
  return NextResponse.json({ playlists });
}

export async function POST(req: NextRequest) {
  try {
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

    return NextResponse.json({ id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
