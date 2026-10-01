/**
 * One readable line for an error, never a dumped object.
 *
 * A googleapis (gaxios) failure logged with console.error(err) prints its
 * whole request and response config, about 60 lines per failure, and the
 * line that matters is buried in there. This pulls that line out, and adds
 * the fix for the one failure that needs a human.
 */
export function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);

  const data = (err as { response?: { data?: { error?: unknown; error_description?: unknown } } }).response?.data;
  const code = typeof data?.error === "string" ? data.error : undefined;
  const description = typeof data?.error_description === "string" ? data.error_description : undefined;

  if (code === "invalid_grant") {
    return (
      `Google refused the refresh token (invalid_grant: ${description ?? "expired or revoked"}). ` +
      "Mail triage and win alerts are down until it's replaced. Run `npm run gmail:auth`, or switch to an app password (GMAIL_APP_PASSWORD, see README)."
    );
  }

  const where = err.stack?.split("\n").find((line) => line.includes("/src/"))?.trim();
  return [`${err.name}: ${err.message}`, code && `(${code}${description ? `: ${description}` : ""})`, where]
    .filter(Boolean)
    .join(" ");
}
