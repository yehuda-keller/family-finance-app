import type * as XLSXModule from 'xlsx';

import { Row } from './parsers';

// Leumi's ".xls" exports are really HTML tables, preceded by whitespace
// that stops SheetJS from sniffing them as HTML (it then reads them as
// latin1 text). Real .xlsx/.xls files start with binary magic bytes.
function asHtml(buffer: ArrayBuffer): string | null {
  const head = new TextDecoder('utf-8').decode(buffer.slice(0, 1024)).trimStart();

  if (!head.startsWith('<')) {
    return null;
  }

  return new TextDecoder('utf-8').decode(buffer).trim();
}

// All sheets' rows, in order. Leumi puts the title (with the card number),
// the pending table and the charged table on separate sheets.
export function readWorkbookRows(XLSX: typeof XLSXModule, buffer: ArrayBuffer): Row[] {
  const html = asHtml(buffer);

  const workbook = html
    ? // raw: keep cell text as-is. Otherwise SheetJS parses "10/09/2026"
      // as US mm/dd (October 9) whenever the day is 12 or less.
      XLSX.read(html, { type: 'string', raw: true })
    : XLSX.read(buffer, { cellDates: true });

  return workbook.SheetNames.flatMap((name) =>
    XLSX.utils.sheet_to_json<Row>(workbook.Sheets[name], {
      header: 1,
      raw: true,
      defval: '',
    }),
  );
}
