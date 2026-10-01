import { format } from "node:util";

/**
 * Under systemd, give console.warn/console.error their real journal priority.
 *
 * journald logs everything a service writes at "info", stderr included, unless
 * a line starts with a syslog-style "<N>" prefix. Without one, `journalctl -p
 * warning` found nothing, even across days of failed entries. systemd sets
 * JOURNAL_STREAM for a service whose output goes to the journal, so outside one
 * (a terminal, `npm run run:entries`, tests) this does nothing.
 *
 * The prefix goes on every line because journald reads each line as a
 * separate record. A stack trace keeps its priority all the way down.
 */
if (process.env.JOURNAL_STREAM) {
  const withPriority = (priority: number, write: (...args: unknown[]) => void) => (...args: unknown[]) =>
    write(
      format(...args)
        .split("\n")
        .map((line) => `<${priority}>${line}`)
        .join("\n"),
    );
  console.warn = withPriority(4, console.warn.bind(console));
  console.error = withPriority(3, console.error.bind(console));
}
