import { spawn } from "child_process";
import { join } from "path";
import { readFileSync } from "fs";

const extractScript = join(process.cwd(), "extract.py");
const pdfBytes = readFileSync("/Users/rithvik1/Desktop/ZAMP TASK/Files to Upload/PDF'S/INV_001_clean_acme_office.pdf");

const proc = spawn("python3", [extractScript], { stdio: ["pipe", "pipe", "pipe"] });
let stdout = "";
let stderr = "";

proc.stdout?.on("data", (data) => {
  stdout += data.toString();
  console.log("STDOUT:", data.toString().substring(0, 100));
});

proc.stderr?.on("data", (data) => {
  stderr += data.toString();
  console.log("STDERR:", data.toString());
});

proc.on("error", (error) => {
  console.log("PROC ERROR:", error);
});

proc.on("close", (code) => {
  console.log("EXIT CODE:", code);
  console.log("STDERR:", stderr);
  console.log("STDOUT LENGTH:", stdout.length);
  console.log("STDOUT:", stdout.substring(0, 200));
  try {
    const json = JSON.parse(stdout);
    console.log("PARSED JSON:", json.invoice_number);
  } catch (e) {
    console.log("JSON PARSE ERROR:", e.message);
  }
});

proc.stdin?.write(pdfBytes);
proc.stdin?.end();

