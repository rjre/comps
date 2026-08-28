import "./globals.css";
import type { ReactNode } from "react";
import Link from "next/link";

export const metadata = {
  title: "Comps — Automated Giveaway Entry Assistant",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav>
          <Link href="/dashboard">Dashboard</Link>
          <Link href="/profile">Profile</Link>
          <Link href="/competitions">Competitions</Link>
          <Link href="/newsletters">Newsletters</Link>
          <Link href="/sources">Sources</Link>
          <Link href="/wins">Wins</Link>
          <Link href="/runs">Runs</Link>
        </nav>
        <hr />
        {children}
      </body>
    </html>
  );
}
