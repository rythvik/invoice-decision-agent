import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import SessionCleanup from "./SessionCleanup";

export const metadata: Metadata = {
  title: "Invoice Decision Agent",
  description: "From PDF to a clear, reasoned decision — every step visible.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <div className="topbar">
            <div className="brand">
              invoice<span>·decision·</span>agent
            </div>
            <nav className="nav">
              <Link href="/">Inbox</Link>
              <Link href="/dashboard">Dashboard</Link>
              <Link href="/raw">Raw DB</Link>
            </nav>
          </div>
          {children}
        </div>
        <SessionCleanup />
      </body>
    </html>
  );
}
