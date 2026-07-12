// Out-of-the-box: first API hit seeds the vendor + PO masters. The inbox is real
// email now (populated via IMAP), so nothing fake is seeded there.
import path from "path";
import { db, seedMasters } from "./db";

let seeded = false;

export function ensureSeeded(): void {
  if (seeded) return;
  const count = (db().prepare("SELECT COUNT(*) AS c FROM vendors").get() as any).c;
  if (count === 0) seedMasters(path.join(process.cwd(), "data"));
  seeded = true;
}
