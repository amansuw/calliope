import { NextRequest, NextResponse } from "next/server";
import {
  getMonitoredPlaylist,
  updateMonitoredPlaylist,
  deleteMonitoredPlaylist,
} from "@/lib/db";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const playlist = getMonitoredPlaylist(id);
  if (!playlist) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json();
  const updates: Record<string, unknown> = {};

  if (body.enabled !== undefined) updates.enabled = body.enabled ? 1 : 0;
  if (body.name !== undefined) updates.name = body.name;

  updateMonitoredPlaylist(id, updates);
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  deleteMonitoredPlaylist(id);
  return NextResponse.json({ deleted: true });
}
