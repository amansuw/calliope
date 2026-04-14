import { NextRequest, NextResponse } from "next/server";
import { enqueueUrls } from "@/lib/queue";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { urls, format, quality } = body;

    if (!urls || typeof urls !== "string") {
      return NextResponse.json(
        { error: "Missing 'urls' field" },
        { status: 400 }
      );
    }

    const jobIds = await enqueueUrls(urls, format, quality);
    return NextResponse.json({ jobIds });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
