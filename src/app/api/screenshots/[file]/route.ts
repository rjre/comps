import { readFile } from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";

const SCREENSHOT_DIR = path.join(process.cwd(), "data", "screenshots");
// Screenshots are named `${runId}_${competitionId}_${reason}.png` by the
// runner — cuid segments plus a short reason word, nothing else.
const SAFE_FILENAME = /^[a-zA-Z0-9_-]+\.png$/;

export async function GET(_req: NextRequest, { params }: { params: { file: string } }) {
  if (!SAFE_FILENAME.test(params.file)) {
    return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
  }
  try {
    const data = await readFile(path.join(SCREENSHOT_DIR, params.file));
    return new NextResponse(data, { headers: { "Content-Type": "image/png" } });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
