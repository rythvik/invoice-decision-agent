// Out-of-the-box experience: first API hit auto-seeds the bundled test world.
import path from "path";
import { db, seedAll } from "./db";

let seeded = false;

export function ensureSeeded(): void {
  if (seeded) return;
  const count = (db().prepare("SELECT COUNT(*) AS c FROM vendors").get() as any).c;
  if (count === 0) seedAll(path.join(process.cwd(), "data"));
  seeded = true;
}
