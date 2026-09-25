import * as XLSX from 'xlsx';

import { parseStatement } from './parsers';
import { readWorkbookRows } from './read-workbook';

// Leumi's ".xls" export: HTML with leading whitespace and one table per section
const LEUMI_HTML_XLS = `
		<HTML dir="RTL"><head><META http-equiv="Content-Type" content="text/html; charset=UTF-8"></head>
<body>
<table><tr><td>פרוט עסקאות לכרטיסלאומי ויזה4449לתקופה:אוקטובר 2026</td></tr></table>
<table>
<tr><td>עסקאות בש"ח במועד החיוב</td></tr>
<tr><td>תאריך העסקה</td><td>שם בית העסק</td><td>סכום העסקה</td><td>סוג העסקה</td><td>פרטים</td><td>סכום חיוב</td></tr>
<tr><td>10/09/26</td><td>סופרכל בן שמן</td><td>1,066.40</td><td>עסקה רגילה</td><td></td><td>1,066.40</td></tr>
<tr><td>03/09/26</td><td>המוסד לביטוח לאומי</td><td>906.00</td><td>עסקת תשלומים רגילה</td><td>עסקה בתשלומים תשלום - 2 מ - 2.</td><td>454.00</td></tr>
</table>
</body></HTML>`;

function toArrayBuffer(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

describe('readWorkbookRows', () => {
  const rows = readWorkbookRows(XLSX, toArrayBuffer(LEUMI_HTML_XLS));
  const result = parseStatement(rows)!;

  it('reads Hebrew text from HTML disguised as .xls', () => {
    expect(result.transactions[0].description).toBe('סופרכל בן שמן');
  });

  it('reads dd/mm dates as day first, not US month first', () => {
    // SheetJS would otherwise turn 10/09 into October 9
    expect(result.transactions[0].date).toEqual(new Date(2026, 8, 10, 12));
  });

  it('finds the card number on a different table than the transactions', () => {
    expect(result.transactions.every((t) => t.card === '4449')).toBeTrue();
  });

  it('parses installments and amounts with thousands separators', () => {
    expect(result.transactions[0].amount).toBe(1066.4);
    expect(result.transactions[1].installment).toEqual({ number: 2, total: 2 });
    expect(result.transactions[1].date).toEqual(new Date(2026, 9, 3, 12));
  });
});
