// Google Cloud Vision API for document OCR — replaces Gemini for reliable PDF extraction.
import { GoogleAuth } from "google-auth-library";
import type { ExtractedInvoice, ExtractHints, ExtractionProvider, LineItem, Confidence } from "../types";

export class VisionExtractor implements ExtractionProvider {
  name = "vision";
  private auth: GoogleAuth;

  constructor(credentialsPath: string) {
    this.auth = new GoogleAuth({
      keyFilename: credentialsPath,
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });
  }

  async extract(bytes: Buffer, hints: ExtractHints): Promise<ExtractedInvoice> {
    try {
      const client = await this.auth.getClient();
      const projectId = await this.auth.getProjectId();

      // Call Vision API with batch annotations
      const response = await client.request({
        url: `https://vision.googleapis.com/v1/projects/${projectId}/images:annotate`,
        method: "POST",
        data: {
          requests: [
            {
              image: { content: bytes.toString("base64") },
              features: [
                { type: "DOCUMENT_TEXT_DETECTION" }, // OCR: extract all text
              ],
            },
          ],
        },
      });

      const annotations = (response.data as any).responses?.[0];
      if (!annotations) throw new Error("Vision API returned no annotations");

      // Extract text from document
      const fullText = annotations.fullTextAnnotation?.text || "";
      if (!fullText) throw new Error("No text detected in document");

      // Parse extracted text into structured data using simple heuristics
      const extracted = this.parseInvoiceText(fullText);
      return extracted;
    } catch (e: any) {
      throw new Error(`Vision API error: ${e.message}`);
    }
  }

  private parseInvoiceText(text: string): ExtractedInvoice {
    // Simple regex-based extraction from OCR'd text
    const lines = text.split("\n").map((l) => l.trim());

    const inv: ExtractedInvoice = {
      is_invoice: true,
      document_kind: "digital",
      vendor_name: null,
      vendor_email: null,
      invoice_number: null,
      invoice_date: null,
      due_date: null,
      po_reference: null,
      currency: "USD",
      line_items: [],
      subtotal: null,
      tax: null,
      discount: null,
      total: null,
      bank_account: null,
      remit_to_name: null,
      vendor_tax_id: null,
      payment_terms: null,
      urgency_language: [],
      field_confidence: {},
      notes: null,
    };

    // Extract invoice number (look for "Invoice #", "INV-", etc.)
    let invMatch = text.match(/(?:Invoice\s+#?|INV[:-]?)\s*([A-Z0-9\-\.\/]+)/i);
    inv.invoice_number = invMatch?.[1] || null;

    // Extract PO number
    let poMatch = text.match(/(?:PO\s+#?|Purchase\s+Order[:#]?)\s*([A-Z0-9\-\.\/]+)/i);
    inv.po_reference = poMatch?.[1] || null;

    // Extract vendor name (usually near top, before "Invoice")
    const vendorLines = lines.slice(0, 10);
    for (const line of vendorLines) {
      if (
        line.length > 3 &&
        line.length < 100 &&
        !line.match(/^(invoice|bill|statement|amount|date|po|purchase)/i)
      ) {
        inv.vendor_name = line;
        break;
      }
    }

    // Extract dates (YYYY-MM-DD or M/D/YYYY format)
    let dateMatches = text.match(/\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4}/g);
    if (dateMatches) {
      inv.invoice_date = dateMatches[0];
      if (dateMatches[1]) inv.due_date = dateMatches[1];
    }

    // Extract total amount (look for "Total:", "Amount:", "$", "€", etc.)
    let totalMatch = text.match(/(?:Total|Amount|Grand\s+Total)[:\s]+(?:\$|€|₹)?[\s]*([\d,]+\.?\d*)/i);
    if (totalMatch) inv.total = parseFloat(totalMatch[1].replace(/,/g, ""));

    // Extract subtotal
    let subtotalMatch = text.match(/(?:Subtotal|Sub-Total)[:\s]+(?:\$|€|₹)?[\s]*([\d,]+\.?\d*)/i);
    if (subtotalMatch) inv.subtotal = parseFloat(subtotalMatch[1].replace(/,/g, ""));

    // Extract tax
    let taxMatch = text.match(/(?:Tax|VAT|GST)[:\s]+(?:\$|€|₹)?[\s]*([\d,]+\.?\d*)/i);
    if (taxMatch) inv.tax = parseFloat(taxMatch[1].replace(/,/g, ""));

    // Extract currency symbol
    if (text.includes("€")) inv.currency = "EUR";
    if (text.includes("₹")) inv.currency = "INR";
    if (text.includes("£")) inv.currency = "GBP";

    // Extract email
    let emailMatch = text.match(/[\w\.\-+]+@[\w\.\-]+/);
    inv.vendor_email = emailMatch?.[0] || null;

    // Extract tax ID / VAT
    let taxIdMatch = text.match(/(?:Tax\s+ID|VAT|EIN|GST)[:\s#+]*([A-Z0-9\-]+)/i);
    inv.vendor_tax_id = taxIdMatch?.[1] || null;

    // Extract bank account
    let bankMatch = text.match(/(?:Account|Bank)[:\s#]*(\d+[\s\-]*\d+)/i);
    inv.bank_account = bankMatch?.[1]?.replace(/\s/g, "") || null;

    return inv;
  }
}
