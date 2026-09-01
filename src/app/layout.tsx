import "./globals.css";
import type { ReactNode } from "react";
import { NavLink } from "@/components/NavLink";
import { getServiceHealth, ago } from "@/lib/health";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Comps — Automated Giveaway Entry Assistant",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const { lastRun, stale } = await getServiceHealth();
  const state = !lastRun ? "unknown" : stale ? "stale" : "ok";
  const healthLabel = !lastRun ? "no runs yet" : `${stale ? "stalled — " : ""}last pass ${ago(lastRun.startedAt)}`;

  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <div className="site-header-inner">
            <NavLink href="/dashboard">
              <span className="brand">
                <span className="brand-mark">🎟</span>
                Comps
              </span>
            </NavLink>
            <nav className="site-nav">
              <NavLink href="/dashboard">Dashboard</NavLink>
              <NavLink href="/profile">Profile</NavLink>
              <NavLink href="/competitions">Competitions</NavLink>
              <NavLink href="/newsletters">Newsletters</NavLink>
              <NavLink href="/sources">Sources</NavLink>
              <NavLink href="/wins">Wins</NavLink>
              <NavLink href="/runs">Runs</NavLink>
            </nav>
            <span className="health-pill">
              <span className="health-dot" data-state={state} />
              {healthLabel}
            </span>
          </div>
        </header>
        <div className="page">{children}</div>
      </body>
    </html>
  );
}
