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
  // stable key built from the row's content; hashed into the doc id
  dedupeKey: string;
  // set when the row shouldn't be imported by default, e.g. a card's
  // monthly charge in the bank account (its purchases come from the card file)
  skipReason?: string;
}

export interface ParseResult {
  format: string;
  transactions: ParsedTransaction[];
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

// "תשלום 2 מ 3", "תשלום - 2 מ - 3", "תשלום 23 מ - 24"
export function parseInstallment(
  text: string,
): { number: number; total: number } | undefined {
  const match = text.match(/תשלום\s*-?\s*(\d+)\s*מ\s*-?\s*(\d+)/);

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
  const texts = row.map(cellText);
  const indexes: Record<string, number> = {};

  for (const [key, header] of Object.entries(columns)) {
    const index = texts.indexOf(header);

    if (index < 0) {
      return null;
    }

    indexes[key] = index;
  }

  return indexes;
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

  // "פרוט עסקאות לכרטיס לאומי ויזה 2127" in the title rows, else the file name
  const cardMatch =
    rows
      .flat()
      .map(cellText)
      .join(' ')
      .match(/כרטיס[^\d]{0,30}(\d{4})\b/) ?? fileName.match(/(\d{4})/);
  const card = cardMatch?.[1];

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

    // installment k of n is dated k-1 months after the purchase,
    // so it lands in the budget month it's actually charged in
    const date = installment
      ? addMonths(purchaseDate, installment.number - 1)
      : purchaseDate;

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
  };
}

// Card statement first: its title rows could never match the account header,
// but checking the more specific format first keeps detection unambiguous
export function parseStatement(rows: Row[], fileName = ''): ParseResult | null {
  return parseLeumiCard(rows, fileName) ?? parseLeumiAccount(rows);
}
