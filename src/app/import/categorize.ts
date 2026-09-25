import { TransactionType } from '../services/transaction.service';

type Rule = { pattern: RegExp; category: string };

// Categories must be from CATEGORIES (src/app/categories.ts).
// First match wins, so more specific patterns go first.
const INCOME_RULES: Rule[] = [
  { pattern: /משכורת|שכר|מילואי|מופ"ת/, category: 'משכורת' },
];

const EXPENSE_RULES: Rule[] = [
  { pattern: /סופר.?פארם|super.?pharm|קוסמטיק|אסתטי|מספרה|barber|rebrab/i, category: 'קוסמטיקה' },

  { pattern: /ביטוח|בטוח|מגדל|הראל|הפניקס|מנורה|איילון|ש\. שלמה|הכשרה|גמל|פנסי|השתלמות|מיטב/, category: 'ביטוחים' },

  { pattern: /שופרסל|יוחננוף|אושר עד|רמי לוי|סופרכל|ויקטורי|יינות ביתן|טיב טעם|מחסני השוק|חצי חינם|קרפור|סופר/, category: 'סופר' },

  { pattern: /דלק|סונול|(^|\s)פז(\s|$)|\bten\b|yellow|פנגו|חניו|רכבת|אגד|רב.?קו|gett|כביש 6|מוסך/i, category: 'תחבורה' },

  { pattern: /(^|\s)גן(\s|$)|צהרון|בית ספר|חינוך|מכון|אוניברסיט|מכללה|חוג/, category: 'חינוך' },

  { pattern: /איקאה|ikea|\bace\b|הום סנטר|חברת החשמל|ארנונה|עירי|בזק|\bhot\b|פרטנר|סלקום|ועד בית|\bksp\b|בעצם הבית/i, category: 'אחזקת בית' },

  { pattern: /כושר|פיטנס|יס פלאנט|סינמה|קולנוע|מסעד|קפה|קיוסק|פיצ|בורגר|wolt|וולט|תן ביס|10bis|ג'מפ|jump|netflix|spotify|apple\.com|itunes|anthropic/i, category: 'בילוי' },

  { pattern: /טרמינל איקס|זארה|zara|h&m|קסטרו|פוקס|\bfox\b|גולף|shein|asos/i, category: 'ביגוד' },
];

export function categorize(description: string, type: TransactionType): string {
  const rules = type === 'income' ? INCOME_RULES : EXPENSE_RULES;

  return rules.find(({ pattern }) => pattern.test(description))?.category ?? 'שונות';
}
