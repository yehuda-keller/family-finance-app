import { categorize } from './categorize';
import {
  parseAmount,
  parseDate,
  parseInstallment,
  parseLeumiAccount,
  parseLeumiCard,
  parseStatement,
} from './parsers';

// Row layouts mirror Leumi's web statements (Sept 2026 samples)

const ACCOUNT_ROWS = [
  ['בנק לאומי | תנועות בחשבון'],
  ['תאריך', 'תאריך ערך', 'תיאור', 'אסמכתא', 'בחובה', 'בזכות', 'היתרה בש"ח'],
  ['23/09/2026', '23/09/2026', 'הפועלים-ביט', '99012', '', '163.00', '-20,619.91'],
  ['22/09/2026', '22/09/2026', 'קצבת ילדים-י', '13104', '', '276.00', '-20,694.91'],
  ['14/09/2026', '14/09/2026', 'שיק', '5000043', '3,200.00', '', '-20,910.91'],
  ['10/09/2026', '10/09/2026', 'לאומי ויזה', '114449', '4,709.14', '', '-17,410.91'],
  ['10/09/2026', '10/09/2026', 'ישראכרט-כ.וי-י', '39086', '7,298.77', '', '-1,019.29'],
  ['10/09/2026', '10/09/2026', 'לאומי ויזה', '102127', '11,682.48', '', '-12,701.77'],
  ['16/08/2026', '16/08/2026', 'הפועלים-ביט', '99012', '', '600.00', '7,897.20'],
];

const CARD_ROWS = [
  ['פרוט עסקאות לכרטיס לאומי ויזה 2127'],
  ['לתקופה: אוקטובר 2026'],
  ['עסקאות אחרונות שטרם נקלטו'],
  ['תאריך העסקה', 'שעה', 'שם בית העסק', 'סוג העסקה', 'פרטים', 'סכום העסקה'],
  ['25.09.26', '03:24', 'APPLE.COM/BILL', 'עסקה רגילה', '', '11.90'],
  ['23.09.26', '11:20', 'אושר עד לוד', 'עסקה רגילה', '', '697.59'],
  ['עסקאות בש"ח במועד החיוב'],
  ['תאריך העסקה', 'שם בית העסק', 'סכום העסקה', 'סוג העסקה', 'פרטים', 'סכום חיוב'],
  ['20/09/26', 'איקאה IKEA', '237.00', 'עסקה רגילה', '', '237.00'],
  ['19/09/26', "לגנ'דה יס פלאנט", '24.00', 'עסקה רגילה', '', '-1.20'],
  ['19/09/26', "לגנ'דה יס פלאנט", '24.00', 'עסקה רגילה', '', '24.00'],
  ['18/09/26', 'סופרכל בן שמן', '5.90', 'עסקה רגילה', '', '5.90'],
  ['18/09/26', 'סופרכל בן שמן', '5.90', 'עסקה רגילה', '', '5.90'],
  ['24/08/26', 'איילת גייר רפואה אסתטית-צמרת', '2,000.00', 'עסקת תשלומים', 'עסקה בתשלומים תשלום 2 מ- 3', '666.00'],
  ['26/11/24', 'KSP תלפיות', '6,254.00', 'עסקת תשלומים', 'תשלום 23 מ - 24', '260.00'],
  ['סה"כ: 5,762.24'],
];

describe('parsers', () => {
  describe('parseAmount', () => {
    it('handles commas, minus signs and numbers', () => {
      expect(parseAmount('1,920.00')).toBe(1920);
      expect(parseAmount('-1.20')).toBe(-1.2);
      expect(parseAmount('150.00-')).toBe(-150);
      expect(parseAmount(42.5)).toBe(42.5);
      expect(parseAmount('')).toBeNull();
      expect(parseAmount('abc')).toBeNull();
    });
  });

  describe('parseDate', () => {
    it('parses the formats Leumi uses', () => {
      expect(parseDate('20/09/26')).toEqual(new Date(2026, 8, 20, 12));
      expect(parseDate('23/09/2026')).toEqual(new Date(2026, 8, 23, 12));
      expect(parseDate('25.09.26')).toEqual(new Date(2026, 8, 25, 12));
    });

    it('parses Excel serial numbers and Date cells', () => {
      // 46285 = 2026-09-20
      expect(parseDate(46285)).toEqual(new Date(2026, 8, 20, 12));
      expect(parseDate(new Date(2026, 8, 20, 0))).toEqual(new Date(2026, 8, 20, 12));
    });

    it('rejects non-dates', () => {
      expect(parseDate('סה"כ')).toBeNull();
      expect(parseDate('32/01/26')).toBeNull();
      expect(parseDate('')).toBeNull();
    });
  });

  describe('parseInstallment', () => {
    it('reads installment number and total', () => {
      expect(parseInstallment('עסקה בתשלומים תשלום 2 מ- 3')).toEqual({ number: 2, total: 3 });
      expect(parseInstallment('תשלום 23 מ - 24')).toEqual({ number: 23, total: 24 });
      // Excel export format
      expect(parseInstallment('עסקה בתשלומים תשלום - 2 מ - 3.')).toEqual({ number: 2, total: 3 });
      expect(parseInstallment('')).toBeUndefined();
    });
  });

  describe('parseLeumiAccount', () => {
    const result = parseLeumiAccount(ACCOUNT_ROWS)!;

    it('reads debits as expenses and credits as income', () => {
      expect(result.transactions.length).toBe(7);

      const check = result.transactions.find((t) => t.description === 'שיק')!;
      expect(check.type).toBe('expense');
      expect(check.amount).toBe(3200);

      const allowance = result.transactions.find((t) => t.description === 'קצבת ילדים-י')!;
      expect(allowance.type).toBe('income');
      expect(allowance.amount).toBe(276);
    });

    it('flags monthly card charges so they are not double counted', () => {
      const skipped = result.transactions.filter((t) => t.skipReason);

      expect(skipped.map((t) => t.description).sort()).toEqual(
        ['ישראכרט-כ.וי-י', 'לאומי ויזה', 'לאומי ויזה'].sort(),
      );
    });

    it('gives every row a distinct dedupe key', () => {
      const keys = result.transactions.map((t) => t.dedupeKey);
      expect(new Set(keys).size).toBe(keys.length);
    });

    it('does not match a card statement', () => {
      expect(parseLeumiAccount(CARD_ROWS)).toBeNull();
    });
  });

  describe('parseLeumiCard', () => {
    const result = parseLeumiCard(CARD_ROWS)!;

    it('reads the card number from the title', () => {
      expect(result.transactions.every((t) => t.card === '2127')).toBeTrue();
    });

    it('skips pending transactions and the total row', () => {
      const names = result.transactions.map((t) => t.description);

      expect(names).not.toContain('אושר עד לוד');
      expect(names).not.toContain('APPLE.COM/BILL');
      expect(result.transactions.length).toBe(7);
    });

    it('uses the charged amount, including refunds', () => {
      const legenda = result.transactions.filter((t) => t.description === "לגנ'דה יס פלאנט");

      expect(legenda.map((t) => t.amount).sort()).toEqual([-1.2, 24]);
    });

    it('dates installment k of n k-1 months after the purchase', () => {
      const aesthetic = result.transactions.find((t) => t.description.startsWith('איילת'))!;
      expect(aesthetic.amount).toBe(666);
      expect(aesthetic.installment).toEqual({ number: 2, total: 3 });
      expect(aesthetic.date).toEqual(new Date(2026, 8, 24, 12));

      const ksp = result.transactions.find((t) => t.description.startsWith('KSP'))!;
      expect(ksp.date).toEqual(new Date(2026, 8, 26, 12));
    });

    it('keeps identical purchases on the same day as separate rows', () => {
      const keys = result.transactions.map((t) => t.dedupeKey);
      expect(new Set(keys).size).toBe(keys.length);
    });

    it('gives the same keys when the same file is parsed again', () => {
      const again = parseLeumiCard(CARD_ROWS)!;
      expect(again.transactions.map((t) => t.dedupeKey)).toEqual(
        result.transactions.map((t) => t.dedupeKey),
      );
    });
  });

  describe('parseStatement', () => {
    it('detects the format', () => {
      expect(parseStatement(CARD_ROWS)!.transactions[0].source).toBe('leumi-card');
      expect(parseStatement(ACCOUNT_ROWS)!.transactions[0].source).toBe('leumi-account');
      expect(parseStatement([['שלום'], ['1', '2']])).toBeNull();
    });
  });
});

describe('categorize', () => {
  it('categorizes merchants from the statements', () => {
    expect(categorize('יוחננוף רמלה', 'expense')).toBe('סופר');
    expect(categorize('אושר עד לוד', 'expense')).toBe('סופר');
    expect(categorize('דלק מנטה קמעונאות דרכים ב', 'expense')).toBe('תחבורה');
    expect(categorize('פנגו-חניונים', 'expense')).toBe('תחבורה');
    expect(categorize('מגדל חיים/בריאות', 'expense')).toBe('ביטוחים');
    expect(categorize('איילון רכב חובה', 'expense')).toBe('ביטוחים');
    expect(categorize('איקאה IKEA', 'expense')).toBe('אחזקת בית');
    expect(categorize('טרמינל איקס אונליין בע"מ.', 'expense')).toBe('ביגוד');
    expect(categorize('איילת גייר רפואה אסתטית-צמרת', 'expense')).toBe('קוסמטיקה');
    expect(categorize('BIT', 'expense')).toBe('שונות');
  });

  it('never gives income an expense category', () => {
    expect(categorize('בטוח לאומי ח-י', 'income')).toBe('שונות');
    expect(categorize('מופ"ת מילואי-י', 'income')).toBe('משכורת');
    expect(categorize('הפועלים-ביט', 'income')).toBe('שונות');
  });
});
