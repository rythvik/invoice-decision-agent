// Initialize + seed the local database from data/*.json
import path from "path";
import { loadEnv } from "./env";
loadEnv();

import { resetDb, seedAll } from "../lib/db";

const reset = process.argv.includes("--reset");
if (reset) {
  resetDb();
  console.log("Database reset.");
}
const counts = seedAll(path.join(process.cwd(), "data"));
console.log(`Seeded: ${counts.vendors} vendors, ${counts.pos} purchase orders, ${counts.inbox} inbox messages.`);
