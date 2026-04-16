import { NextRequest, NextResponse } from "next/server";
import { validatePath } from "@/lib/config";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { path } = body;

  if (!path) {
    return NextResponse.json(
      { valid: false, error: "Path is required" },
      { status: 400 }
    );
  }

  const result = validatePath(path);
  return NextResponse.json(result);
}