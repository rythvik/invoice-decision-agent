import type { ExtractedInvoice, ExtractHints, ExtractionProvider } from "../types";

export class OcrSpaceProvider implements ExtractionProvider {
  name = "ocrspace";
  // Fixed: Regex patterns now handle service invoice layouts with line breaks

  async extract(bytes: Buffer, hints: ExtractHints): Promise<ExtractedInvoice> {
    try {
      const apiKey = process.env.OCRSPACE_API_KEY;
      if (!apiKey) {
        throw new Error("OCRSPACE_API_KEY is not set. Get a free key at https://ocr.space");
      }

      // OCR.Space free API — use JSON for base64 upload (more reliable than multipart)
      const response = await fetch("https://api.ocr.space/parse/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base64image: `data:${hints.mime};base64,${bytes.toString("base64")}`,
          apikey: apiKey,
          filetype: hints.mime === "application/pdf" ? "PDF" : "image",
          ocrengine: "2",
        }),
      });

      const result = await response.json();
      if (!result.IsErroredOnProcessing && result.ParsedResults?.[0]?.ParsedText) {
        return this.parseInvoiceText(result.ParsedResults[0].ParsedText);
      } else {
        throw new Error(`OCR.Space: ${result.ErrorMessage?.[0] || result.ErrorMessage || "No text detected"}`);
      }
    } catch (e: any) {
      throw new Error(`OCR.Space error: ${e.message}`);
    }
  }

  private parseInvoiceText(text: string): ExtractedInvoice {
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

    // Invoice number — look for patterns like "Invoice #: INV-123", "#INV-123", "Invoice Date:" rarely has # so exclude that line
    let invMatch = text.match(/(?:^|\n)Invoice\s*#?:\s*([A-Za-z0-9\-\.\/]+)/mi);
    if (!invMatch) invMatch = text.match(/(?:^|\n)#\s*([A-Za-z0-9\-\.\/]+)/mi);
    if (invMatch) inv.invoice_number = invMatch[1];

    // PO number — look for "PO Number:", "PO Reference:", "PO:", "Purchase Order:" patterns
    let poMatch = text.match(/PO\s+(?:Number|Reference|#)[:\s]+([A-Z0-9\-]+)/i);
    if (!poMatch) poMatch = text.match(/(?:Purchase\s+Order)[:\s#]+([A-Z0-9\-]+)/i);
    if (!poMatch) poMatch = text.match(/(?:^|\n)PO[:\s]+([A-Z0-9\-]+)/mi);
    if (poMatch) inv.po_reference = poMatch[1];

    // Vendor name (first substantial line)
    const lines = text.split("\n").map(l => l.trim()).filter(l => l);
    for (const line of lines.slice(0, 10)) {
      if (line.length > 3 && line.length < 100 && !/^(invoice|bill|statement|amount|date|po|purchase|currency|terms)/i.test(line)) {
        inv.vendor_name = line.replace(/\s+INVOICE\s*$/i, "");
        break;
      }
    }

    // Dates
    const dateMatches = text.match(/\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4}/g);
    if (dateMatches) {
      inv.invoice_date = dateMatches[0];
      if (dateMatches[1]) inv.due_date = dateMatches[1];
    }

    // Total — try different patterns: "TOTAL DUE", "Total", "Amount Due" (handles line breaks)
    let totalMatch = text.match(/(?:TOTAL|Amount)\s+DUE[\s\n]*[\$€₹]?\s*([\d,]+\.?\d*)/i);
    if (!totalMatch) totalMatch = text.match(/(?:^|\n)(?:Total|Grand\s+Total)[:\s]+[\$€₹]?\s*([\d,]+(?:\.\d{1,2})?)/mi);
    if (!totalMatch) totalMatch = text.match(/(?:^|\n)Amount\s+Due[\s\n:]*[\$€₹]?\s*([\d,]+(?:\.\d{1,2})?)/mi);

    if (totalMatch) {
      inv.total = parseFloat(totalMatch[1].replace(/,/g, ""));
    } else {
      // Fallback: look for highest amount (handles both $4600 and $4600.50 formats)
      const amounts = text.match(/[\$€₹]?\s*([\d,]+(?:\.\d{1,2})?)/g);
      if (amounts && amounts.length > 0) {
        inv.total = parseFloat(amounts[amounts.length - 1].replace(/[\$€₹\s,]/g, ""));
      }
    }

    // Subtotal
    let subMatch = text.match(/Subtotal\s+(?:[A-Z]{3})?\s+\$?(?:\$|€|₹)?\s*([\d,]+\.?\d*)/i);
    if (!subMatch) subMatch = text.match(/(?:Subtotal|Sub-Total)[:\s]+(?:\$|€|₹)?\s*([\d,]+\.?\d*)/i);
    if (subMatch) inv.subtotal = parseFloat(subMatch[1].replace(/,/g, ""));

    // Tax
    const taxMatch = text.match(/(?:Tax|VAT|GST)[:\s]+(?:\$|€|₹)?\s*([\d,]+\.?\d*)/i);
    if (taxMatch) inv.tax = parseFloat(taxMatch[1].replace(/,/g, ""));

    // Currency
    const currMatch = text.match(/Currency:\s*(EUR|GBP|INR|JPY|CAD|AUD|CHF|CNY)/i);
    if (currMatch) {
      inv.currency = currMatch[1].toUpperCase();
    } else if (text.includes("€")) {
      inv.currency = "EUR";
    } else if (text.includes("₹")) {
      inv.currency = "INR";
    } else if (text.includes("£")) {
      inv.currency = "GBP";
    } else if (text.includes("¥")) {
      inv.currency = "JPY";
    } else if (text.includes("C$") || text.includes("CAD")) {
      inv.currency = "CAD";
    } else if (text.includes("A$") || text.includes("AUD")) {
      inv.currency = "AUD";
    } else if (text.includes("CHF")) {
      inv.currency = "CHF";
    } else if (text.includes("¥") && text.includes("CN")) {
      inv.currency = "CNY";
    }

    // Email
    const emailMatch = text.match(/[\w\.\-+]+@[\w\.\-]+/);
    if (emailMatch) inv.vendor_email = emailMatch[0];

    // Tax ID
    const taxIdMatch = text.match(/(?:Tax\s+ID|VAT|EIN|GST)[:\s#]*([0-9\-]+)/i);
    if (taxIdMatch) inv.vendor_tax_id = taxIdMatch[1];

    // Bank account
    const bankMatch = text.match(/(?:Account|Bank)[:\s#]*(\d+[\s\-]*\d+)/i);
    if (bankMatch) inv.bank_account = bankMatch[1].replace(/\s/g, "");

    return inv;
  }
}
