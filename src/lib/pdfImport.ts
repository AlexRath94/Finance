import type { ParseResult } from './importers';
import { parseStatementLines, type PdfLine } from './pdfLines';

/**
 * Reads bank statements (Kontoauszüge) from PDF. The text layout of PDFs differs per bank,
 * so this is heuristic: every line that starts with a date and contains an amount becomes
 * a booking; following lines are added to its description.
 */
export async function parsePdf(buf: ArrayBuffer): Promise<ParseResult> {
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  const lines: PdfLine[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items = (content.items as { str: string; transform: number[]; width: number }[])
      .filter((i) => i.str && i.str.trim())
      .map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5], w: i.width }));
    // Group by baseline (y), top to bottom.
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    let cur: typeof items = [];
    const flush = () => {
      if (!cur.length) return;
      cur.sort((a, b) => a.x - b.x);
      lines.push({ page: p, tokens: cur.map((t) => ({ text: t.str.trim(), x: t.x, right: t.x + t.w })) });
      cur = [];
    };
    for (const it of items) {
      if (cur.length && Math.abs(cur[0].y - it.y) > 2.5) flush();
      cur.push(it);
    }
    flush();
  }
  const result = parseStatementLines(lines);
  return { ...result, format: 'PDF (experimentell)' };
}
