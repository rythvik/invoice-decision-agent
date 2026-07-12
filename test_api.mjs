import { readFileSync } from "fs";
import { FormData, File } from "node:fetch";

const pdfBytes = readFileSync("/Users/rithvik1/Desktop/ZAMP TASK/Files to Upload/PDF'S/INV_001_clean_acme_office.pdf");

const formData = new FormData();
formData.append("file", new File([pdfBytes], "INV_001_clean_acme_office.pdf", { type: "application/pdf" }));

const response = await fetch("http://localhost:3002/api/process", {
  method: "POST",
  body: formData,
});

console.log("Status:", response.status);
console.log("Content-Type:", response.headers.get("content-type"));

// Stream the response  
const reader = response.body.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  const text = decoder.decode(value, { stream: true });
  const lines = text.split("\n").filter(l => l.trim());
  for (const line of lines) {
    if (line.startsWith("data:")) {
      try {
        const json = JSON.parse(line.slice(5));
        if (json.stage && json.name) {
          console.log(`Stage ${json.stage}: ${json.name} (${json.status})`);
        }
      } catch (e) {
        // Ignore parse errors
      }
    }
  }
}
