export const CATEGORIES = [
  'משכורת',
  'ביטוחים',
  'חינוך',
  'תחבורה',
  'סופר',
  'אחזקת בית',
  'בילוי',
  'קוסמטיקה',
  'ביגוד',
  'שונות',
];

const CATEGORY_ICONS: Record<string, string> = {
  משכורת: '💼',
  ביטוחים: '🛡️',
  חינוך: '🎓',
  תחבורה: '🚗',
  סופר: '🛒',
  'אחזקת בית': '🏠',
  בילוי: '🎉',
  קוסמטיקה: '💄',
  ביגוד: '👕',
  שונות: '📦',
};

export function categoryIcon(category: string): string {
  return CATEGORY_ICONS[category] ?? '📦';
}
