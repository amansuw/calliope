import { NextRequest, NextResponse } from "next/server";
import { listJobs, getTracksForJob } from "@/lib/db";

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const limit = parseInt(searchParams.get("limit") || "50");
  const offset = parseInt(searchParams.get("offset") || "0");

  const jobs = listJobs(limit, offset);
  const jobsWithTracks = jobs.map((job) => ({
    ...job,
    tracks: getTracksForJob(job.id),
  }));

  return NextResponse.json({ jobs: jobsWithTracks });
}
