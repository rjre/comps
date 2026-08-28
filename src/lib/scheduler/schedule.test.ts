// Plain assertions over the pure scheduling decisions, run with
// `npm run test:schedule`. No test framework in the project — this is a
// script that exits non-zero, which is all CI/a pre-commit check needs.
import { decideSchedule } from "@/lib/scheduler/schedule";
const now = new Date("2026-08-28T12:00:00Z");
const ago = (h: number) => new Date(now.getTime() - h * 3600_000);
const E = (status: any, h: number, dryRun = false) => ({ status, attemptedAt: ago(h), dryRun });
let fails = 0;
function check(label: string, got: string, want: string) {
  const ok = got === want;
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}: ${got}${ok ? "" : ` (wanted ${want})`}`);
}
const daily = { maxEntries: 30, entryIntervalHours: null, closesAt: new Date("2026-09-20T00:00:00Z") };
const once = { maxEntries: 1, entryIntervalHours: null, closesAt: null };

check("daily, entered 2h ago", decideSchedule(daily, [E("SUCCESS", 2)], now).action, "WAIT");
check("daily, entered 25h ago", decideSchedule(daily, [E("SUCCESS", 25)], now).action, "ENTER");
check("daily, site said already-entered 3h ago", decideSchedule(daily, [E("SKIPPED_ALREADY_ENTERED", 3)], now).action, "WAIT");
check("daily, never entered", decideSchedule(daily, [], now).action, "ENTER");
check("daily, dry run only", decideSchedule(daily, [E("SUCCESS", 1, true)], now).action, "ENTER");
check("daily, failure 30m ago", decideSchedule(daily, [E("FAILED", 0.5), E("SUCCESS", 30)], now).action, "WAIT");
check("daily, failure 2h ago (1h backoff spent)", decideSchedule(daily, [E("FAILED", 2), E("SUCCESS", 30)], now).action, "ENTER");
check("daily, 3 failures 3h ago (4h backoff)", decideSchedule(daily, [E("FAILED", 3), E("FAILED", 9), E("FAILED", 15)], now).action, "WAIT");
check("daily, failure after recent success -> interval still holds",
  decideSchedule(daily, [E("FAILED", 3), E("SUCCESS", 5)], now).action, "WAIT");
check("daily, 12 consecutive failures", decideSchedule(daily, Array.from({length:12},(_,i)=>E("FAILED", 30+i*24)), now).action, "GIVE_UP");
check("daily, 12 failures but a success in between",
  decideSchedule(daily, [...Array.from({length:6},(_,i)=>E("FAILED", 30+i*24)), E("SUCCESS", 200), ...Array.from({length:6},(_,i)=>E("FAILED", 300+i*24))], now).action, "ENTER");
check("closed", decideSchedule({ ...daily, closesAt: ago(1) }, [], now).action, "CLOSE");
check("one-shot cap reached", decideSchedule(once, [E("SUCCESS", 100)], now).action, "CAP_REACHED");
check("one-shot never entered", decideSchedule(once, [], now).action, "ENTER");
check("one-shot after a failure 10m ago", decideSchedule(once, [E("FAILED", 0.16)], now).action, "WAIT");
check("SKIPPED_RULES rechecks daily, not every pass", decideSchedule(once, [E("SKIPPED_RULES", 2)], now).action, "WAIT");
check("SKIPPED_RULES recheck due after 25h", decideSchedule(once, [E("SKIPPED_RULES", 25)], now).action, "ENTER");
check("SKIPPED_RULES doesn't trigger failure backoff",
  decideSchedule(once, [E("SKIPPED_RULES", 25), ...Array.from({length:12},(_,i)=>E("FAILED", 30+i*24))], now).action, "ENTER");
check("explicit 6h interval, entered 7h ago", decideSchedule({ ...daily, entryIntervalHours: 6 }, [E("SUCCESS", 7)], now).action, "ENTER");
console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILED`);
process.exitCode = fails ? 1 : 0;
