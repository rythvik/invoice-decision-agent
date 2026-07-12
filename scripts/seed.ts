// Initialize + seed the vendor and PO masters from data/*.json.
// The inbox is real email now, so nothing fake is seeded there.
import path from "path";
import { loadEnv } from "./env";
loadEnv();

import { resetDb, seedMasters } from "../lib/db";

if (process.argv.includes("--reset")) {
  resetDb();
  console.log("Database reset.");
}
const counts = seedMasters(path.join(process.cwd(), "data"));
console.log(`Seeded: ${counts.vendors} vendors, ${counts.pos} purchase orders.`);
