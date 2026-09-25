import { TransactionSource, TransactionType } from '../services/transaction.service';

export type Row = unknown[];

export interface ParsedTransaction {
  source: TransactionSource;
  // last 4 digits of the card, for card statements
  card?: string;
  date: Date;
  type: TransactionType;
  // negative for refunds on a card statement
  amount: number;
  description: string;
  installment?: { number: number; total: number };
  // the card company's merchant category (Isracard's ענף), a categorization hint
  sector?: string;
  // stable key built from the row's content; hashed into the doc id
  dedupeKey: string;
  // set when the row shouldn't be imported by default, e.g. a card's
  // monthly charge in the bank account (its purchases come from the card file)
  skipReason?: string;
}

export interface ParseResult {
  format: string;
  transactions: ParsedTransaction[];
  // card statements print their total; comparing it to the sum of the rows
  // catches rows lost or garbled on the way (e.g. a PDF → Excel conversion)
  expectedTotal?: number;
  actualTotal?: number;
}

// Monthly card charges as they appear in the Leumi current account
const CARD_CHARGE_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /לאומי ויזה/, label: 'לאומי ויזה' },
  { pattern: /ישראכרט/, label: 'ישראכרט' },
];

function cellText(cell: unknown): string {
  if (cell === null || cell === undefined) {
    return '';
  }

  return String(cell).replace(/\s+/g, ' ').trim();
}

// Hebrew gershayim/geresh (״ ׳) and typographic quotes vary between
// exports; compare headers with plain ASCII quotes
function normalizeHeader(text: string): string {
  return text.replace(/[״”“]/g, '"').replace(/[׳’‘]/g, "'");
}

export function parseAmount(cell: unknown): number | null {
  if (typeof cell === 'number') {
    return cell;
  }

  const text = cellText(cell).replace(/[₪,\s]/g, '');

  if (!text) {
    return null;
  }

  // "150.00-" (trailing minus) shows up in some bank exports
  const normalized = text.endsWith('-') ? '-' + text.slice(0, -1) : text;
  const value = Number(normalized);

  return isNaN(value) ? null : value;
}

// Accepts Date objects (SheetJS cellDates), Excel serial numbers,
// and dd/mm/yy, dd/mm/yyyy, dd.mm.yy strings
export function parseDate(cell: unknown): Date | null {
  if (cell instanceof Date) {
    return isNaN(cell.getTime())
      ? null
      : new Date(cell.getFullYear(), cell.getMonth(), cell.getDate(), 12);
  }

  if (typeof cell === 'number' && cell > 20000 && cell < 80000) {
    // Excel serial date: days since 1899-12-30
    const utc = new Date(Date.UTC(1899, 11, 30) + cell * 86400000);

    return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate(), 12);
  }

  const match = cellText(cell).match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/);

  if (!match) {
    return null;
  }

  const day = Number(match[1]);
  const month = Number(match[2]);
  let year = Number(match[3]);

  if (year < 100) {
    year += 2000;
  }

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  return new Date(year, month - 1, day, 12);
}

// "תשלום 2 מ 3", "תשלום - 2 מ - 3", "תשלום 23 מ - 24", "תשלום 2 מתוך 3"
export function parseInstallment(
  text: string,
): { number: number; total: number } | undefined {
  const match = text.match(/תשלום\s*-?\s*(\d+)\s*(?:מתוך|מ)\s*-?\s*(\d+)/);

  if (!match) {
    return undefined;
  }

  return { number: Number(match[1]), total: Number(match[2]) };
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date.getFullYear(), date.getMonth() + months, 1, 12);
  // keep the day, clamped to the target month's length (31/01 + 1 → 28/02)
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(date.getDate(), lastDay));

  return result;
}

function dateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${date.getFullYear()}-${month}-${day}`;
}

// Finds the column index of each header name in a row, or null if any is missing
function matchHeader(
  row: Row,
  columns: Record<string, string>,
): Record<string, number> | null {
  const texts = row.map((cell) => normalizeHeader(cellText(cell)));
  const indexes: Record<string, number> = {};

  for (const [key, header] of Object.entries(columns)) {
    const index = texts.indexOf(normalizeHeader(header));

    if (index < 0) {
      return null;
    }

    indexes[key] = index;
  }

  return indexes;
}

// Index of an optional column in a header row, or -1
function optionalColumn(row: Row, header: string): number {
  return row.map((cell) => normalizeHeader(cellText(cell))).indexOf(header);
}

// Last 4 digits from a title like "פרוט עסקאות לכרטיס לאומי ויזה 2127"
// or "כרטיס המסתיים ב-1975"; falls back to the file name
function findCardNumber(rows: Row[], fileName: string): string | undefined {
  const match =
    rows
      .flat()
      .map(cellText)
      .join(' ')
      .match(/כרטיס[^\d]{0,30}(\d{4})\b/) ?? fileName.match(/(\d{4})/);

  return match?.[1];
}

// The number in the first cell after a label cell, e.g. ["סה\"כ:", 1764.98]
function findLabeledAmount(rows: Row[], label: RegExp): number | undefined {
  for (const row of rows) {
    const index = row.findIndex((cell) => label.test(normalizeHeader(cellText(cell))));

    if (index < 0) {
      continue;
    }

    for (const cell of row.slice(index + 1)) {
      const amount = parseAmount(cell);

      if (amount !== null) {
        return amount;
      }
    }
  }

  return undefined;
}

function sumAmounts(transactions: ParsedTransaction[]): number {
  // round to agorot so float noise doesn't fail the total check
  return Math.round(transactions.reduce((sum, t) => sum + t.amount, 0) * 100) / 100;
}

// installment k of n is dated k-1 months after the purchase,
// so it lands in the budget month it's actually charged in
function chargeMonthDate(
  purchaseDate: Date,
  installment: { number: number } | undefined,
): Date {
  return installment ? addMonths(purchaseDate, installment.number - 1) : purchaseDate;
}

// Identical rows (same day, merchant and amount) are legitimately possible,
// so the n-th repeat within a file gets its own key
function withOccurrence(keys: Map<string, number>, key: string): string {
  const count = (keys.get(key) ?? 0) + 1;
  keys.set(key, count);

  return `${key}|${count}`;
}

const LEUMI_ACCOUNT_COLUMNS = {
  date: 'תאריך',
  description: 'תיאור',
  reference: 'אסמכתא',
  debit: 'בחובה',
  credit: 'בזכות',
};

export function parseLeumiAccount(rows: Row[]): ParseResult | null {
  const headerIndex = rows.findIndex((row) =>
    matchHeader(row, LEUMI_ACCOUNT_COLUMNS),
  );

  if (headerIndex < 0) {
    return null;
  }

  const col = matchHeader(rows[headerIndex], LEUMI_ACCOUNT_COLUMNS)!;
  const seen = new Map<string, number>();
  const transactions: ParsedTransaction[] = [];

  for (const row of rows.slice(headerIndex + 1)) {
    const date = parseDate(row[col['date']]);
    const debit = parseAmount(row[col['debit']]);
    const credit = parseAmount(row[col['credit']]);

    if (!date || (!debit && !credit)) {
      continue;
    }

    const description = cellText(row[col['description']]);
    const reference = cellText(row[col['reference']]);
    const type: TransactionType = credit ? 'income' : 'expense';
    const amount = Math.abs((credit || debit)!);

    const cardCharge = CARD_CHARGE_PATTERNS.find(({ pattern }) =>
      pattern.test(description),
    );

    transactions.push({
      source: 'leumi-account',
      date,
      type,
      amount,
      description,
      dedupeKey: withOccurrence(
        seen,
        `leumi-account|${dateKey(date)}|${reference}|${type}|${amount}`,
      ),
      skipReason:
        cardCharge && type === 'expense'
          ? `חיוב חודשי של ${cardCharge.label} – העסקאות עצמן מגיעות מפירוט הכרטיס`
          : undefined,
    });
  }

  return { format: 'לאומי – תנועות בעו"ש', transactions };
}

// Only the "charged" table has סכום חיוב; the pending table
// ("עסקאות אחרונות שטרם נקלטו") doesn't, so it's never matched
const LEUMI_CARD_COLUMNS = {
  date: 'תאריך העסקה',
  merchant: 'שם בית העסק',
  details: 'פרטים',
  charge: 'סכום חיוב',
};

export function parseLeumiCard(rows: Row[], fileName = ''): ParseResult | null {
  if (!rows.some((row) => matchHeader(row, LEUMI_CARD_COLUMNS))) {
    return null;
  }

  const card = findCardNumber(rows, fileName);

  const seen = new Map<string, number>();
  const transactions: ParsedTransaction[] = [];
  let col: Record<string, number> | null = null;

  for (const row of rows) {
    const header = matchHeader(row, LEUMI_CARD_COLUMNS);

    if (header) {
      col = header;
      continue;
    }

    // a different table's header (e.g. the pending one) ends the charged table
    if (row.map(cellText).includes('תאריך העסקה')) {
      col = null;
      continue;
    }

    if (!col) {
      continue;
    }

    const purchaseDate = parseDate(row[col['date']]);
    const charge = parseAmount(row[col['charge']]);

    if (!purchaseDate || charge === null || charge === 0) {
      continue;
    }

    const merchant = cellText(row[col['merchant']]);
    const installment = parseInstallment(cellText(row[col['details']]));

    const date = chargeMonthDate(purchaseDate, installment);

    transactions.push({
      source: 'leumi-card',
      card,
      date,
      type: 'expense',
      amount: charge,
      description: merchant,
      installment,
      dedupeKey: withOccurrence(
        seen,
        `leumi-card|${card ?? ''}|${dateKey(purchaseDate)}|${merchant}|${charge}|${installment?.number ?? ''}`,
      ),
    });
  }

  return {
    format: `לאומי – פירוט כרטיס${card ? ' ' + card : ''}`,
    transactions,
    expectedTotal: findLabeledAmount(rows, /^סה"כ:?$/),
    actualTotal: sumAmounts(transactions),
  };
}

const ISRACARD_COLUMNS = {
  date: 'תאריך עסקה',
  merchant: 'שם בית העסק',
  charge: 'סכום חיוב בש"ח',
};

export function parseIsracard(rows: Row[], fileName = ''): ParseResult | null {
  const headerIndex = rows.findIndex((row) => matchHeader(row, ISRACARD_COLUMNS));

  if (headerIndex < 0) {
    return null;
  }

  const header = rows[headerIndex];
  const col = matchHeader(header, ISRACARD_COLUMNS)!;
  const sectorCol = optionalColumn(header, 'ענף');
  const detailsCol = optionalColumn(header, 'פירוט נוסף');

  const card = findCardNumber(rows.slice(0, headerIndex), fileName);
  const seen = new Map<string, number>();
  const transactions: ParsedTransaction[] = [];

  for (const row of rows.slice(headerIndex + 1)) {
    const purchaseDate = parseDate(row[col['date']]);
    const charge = parseAmount(row[col['charge']]);

    if (!purchaseDate || charge === null || charge === 0) {
      continue;
    }

    const merchant = cellText(row[col['merchant']]);
    const installment =
      detailsCol >= 0 ? parseInstallment(cellText(row[detailsCol])) : undefined;

    transactions.push({
      source: 'isracard',
      card,
      date: chargeMonthDate(purchaseDate, installment),
      type: 'expense',
      amount: charge,
      description: merchant,
      installment,
      sector: sectorCol >= 0 ? cellText(row[sectorCol]) || undefined : undefined,
      dedupeKey: withOccurrence(
        seen,
        `isracard|${card ?? ''}|${dateKey(purchaseDate)}|${merchant}|${charge}|${installment?.number ?? ''}`,
      ),
    });
  }

  return {
    format: `ישראכרט – פירוט כרטיס${card ? ' ' + card : ''}`,
    transactions,
    expectedTotal: findLabeledAmount(rows.slice(0, headerIndex), /^סך חיוב$/),
    actualTotal: sumAmounts(transactions),
  };
}

// Card statements first: their headers can't match the account's, but
// checking the more specific formats first keeps detection unambiguous
export function parseStatement(rows: Row[], fileName = ''): ParseResult | null {
  return (
    parseIsracard(rows, fileName) ??
    parseLeumiCard(rows, fileName) ??
    parseLeumiAccount(rows)
  );
}
