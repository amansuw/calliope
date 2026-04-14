import { NextRequest, NextResponse } from "next/server";
import { searchTracks } from "@/lib/db";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") || "";
  if (!q.trim()) {
    return NextResponse.json({ tracks: [] });
  }

  const tracks = searchTracks(q.trim(), 50);
  return NextResponse.json({ tracks });
}
