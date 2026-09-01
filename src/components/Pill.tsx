type Tone = "good" | "warn" | "bad" | "neutral";

const TONE_BY_STATUS: Record<string, Tone> = {
  // Competition.status / NewsletterSource.status
  PENDING: "warn",
  ENTERED: "good",
  SUBSCRIBED: "good",
  SKIPPED: "neutral",
  FAILED: "bad",
  CLOSED: "neutral",
  // Entry.status / NewsletterAttempt.status
  SUCCESS: "good",
  SKIPPED_ALREADY_ENTERED: "neutral",
  SKIPPED_RULES: "neutral",
  // Run.status
  RUNNING: "warn",
  COMPLETED: "good",
  // Log level
  INFO: "neutral",
  WARN: "warn",
  ERROR: "bad",
  // ad-hoc, used on /wins and /sources
  new: "warn",
  reviewed: "neutral",
  enabled: "good",
  disabled: "neutral",
};

function label(status: string): string {
  return status.toLowerCase().replace(/_/g, " ");
}

export function Pill({ status, tone }: { status: string; tone?: Tone }) {
  const resolved = tone ?? TONE_BY_STATUS[status] ?? "neutral";
  return <span className={`pill pill-${resolved}`}>{label(status)}</span>;
}
