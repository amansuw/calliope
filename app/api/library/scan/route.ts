import { NextRequest, NextResponse } from "next/server";
import { forceLibraryScan, getLibraryStats, isInLibrary } from "@/lib/library-index";
import { getDb } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const result = await forceLibraryScan();
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const action = searchParams.get("action");

    if (action === "tracks") {
      const db = getDb();
      const tracks = db.prepare(`
        SELECT id, file_path, title, artist, album, duration_s, file_size, scanned_at
        FROM library_tracks
        ORDER BY artist, title
        LIMIT 100
      `).all();
      return NextResponse.json({ tracks });
    }

    if (action === "search") {
      const query = searchParams.get("q") || "";
      const db = getDb();
      const q = `%${query}%`;
      const tracks = db.prepare(`
        SELECT id, file_path, title, artist, album, duration_s
        FROM library_tracks
        WHERE title LIKE ? OR artist LIKE ? OR album LIKE ?
        ORDER BY artist, title
        LIMIT 50
      `).all(q, q, q);
      return NextResponse.json({ tracks });
    }

    const stats = getLibraryStats();
    return NextResponse.json(stats);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}