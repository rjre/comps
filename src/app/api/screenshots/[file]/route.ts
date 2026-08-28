import { readFile } from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";

const SCREENSHOT_DIR = path.join(process.cwd(), "data", "screenshots");
// Screenshots are named `${runId}_${competitionId}_${reason}.jpg` by the
// runner — cuid segments plus a short reason word, nothing else. `.png` is
// still accepted because that's what runs before Aug 2026 wrote, and those
// files stay linked from their historic runs until pruning ages them out.
const SAFE_FILENAME = /^[a-zA-Z0-9_-]+\.(png|jpg)$/;

export async function GET(_req: NextRequest, { params }: { params: { file: string } }) {
  if (!SAFE_FILENAME.test(params.file)) {
    return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
  }
  try {
    const data = await readFile(path.join(SCREENSHOT_DIR, params.file));
    const contentType = params.file.endsWith(".jpg") ? "image/jpeg" : "image/png";
    return new NextResponse(data, { headers: { "Content-Type": contentType } });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
