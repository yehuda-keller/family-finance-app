import {
  Component,
  HostListener,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { Auth, signOut } from '@angular/fire/auth';

import {
  TransactionService,
  Transaction,
  TransactionType,
  transactionDate,
} from '../../services/transaction.service';

import { CATEGORIES, categoryIcon } from '../../categories';
import { ToastService } from '../../services/toast.service';

const MONTH_NAMES = [
  'ינואר',
  'פברואר',
  'מרץ',
  'אפריל',
  'מאי',
  'יוני',
  'יולי',
  'אוגוסט',
  'ספטמבר',
  'אוקטובר',
  'נובמבר',
  'דצמבר',
];

const ALL_PERIODS = 'all';

interface CategoryGroup {
  category: string;
  incomeItems: Transaction[];
  expenseItems: Transaction[];
  incomeTotal: number;
  expenseTotal: number;
}

function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

// 'YYYY-MM-DD' from <input type="date"> → local date at noon,
// so a timezone offset can't push it to the neighbouring day
function fromDateInputValue(value: string): Date | null {
  const [year, month, day] = value.split('-').map(Number);

  if (!year || !month || !day) {
    return null;
  }

  return new Date(year, month - 1, day, 12);
}

// 'YYYY-MM' of the calendar month; income and expenses alike
function periodKeyFor(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [FormsModule, CommonModule, RouterModule],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css',
})
export class DashboardComponent {
  private transactionService = inject(TransactionService);
  private auth = inject(Auth);
  private router = inject(Router);
  private toast = inject(ToastService);

  categories = CATEGORIES;

  transactions = signal<Transaction[]>([]);
  selectedPeriod = signal<string>(periodKeyFor(new Date()));

  type: TransactionType = 'expense';
  amount: number | null = null;
  category = 'סופר';
  description = '';
  date = toDateInputValue(new Date());

  editId: string | null = null;
  saving = false;
  sheetOpen = false;

  listFilter = signal<'all' | TransactionType>('all');
  showAllCategories = signal(false);
  categoryFilter = signal<string | null>(null);

  categoryIcon = categoryIcon;

  // every period that has transactions, plus the current one, newest first
  periods = computed(() => {
    const keys = new Set<string>([periodKeyFor(new Date())]);

    for (const t of this.transactions()) {
      const key = this.periodKey(t);

      if (key) {
        keys.add(key);
      }
    }

    const periods = [...keys].sort().reverse().map((key) => {
      const [year, month] = key.split('-').map(Number);

      return { value: key, label: `${MONTH_NAMES[month - 1]} ${year}` };
    });

    return [{ value: ALL_PERIODS, label: 'כל החודשים' }, ...periods];
  });

  filteredTransactions = computed(() => {
    const selected = this.selectedPeriod();

    const items =
      selected === ALL_PERIODS
        ? this.transactions()
        : this.transactions().filter((t) => this.periodKey(t) === selected);

    return [...items].sort(
      (a, b) =>
        (transactionDate(b)?.getTime() ?? 0) -
        (transactionDate(a)?.getTime() ?? 0),
    );
  });

  transactionsByCategory = computed(() => {
    const byCategory = new Map<string, Transaction[]>(
      this.categories.map((category) => [category, []]),
    );

    for (const t of this.filteredTransactions()) {
      const category = byCategory.has(t.category) ? t.category : 'שונות';
      byCategory.get(category)!.push(t);
    }

    return [...byCategory]
      .map(([category, items]) => this.createCategoryGroup(category, items))
      .filter(
        (group) => group.incomeItems.length > 0 || group.expenseItems.length > 0,
      );
  });

  expenseGroups = computed(() =>
    this.transactionsByCategory()
      .filter((group) => group.expenseTotal > 0)
      .sort((a, b) => b.expenseTotal - a.expenseTotal),
  );

  // top categories only, unless expanded (or the filtered one is further down)
  shownExpenseGroups = computed(() => {
    const groups = this.expenseGroups();
    const selected = this.categoryFilter();

    if (this.showAllCategories()) {
      return groups;
    }

    return groups.filter(
      (group, index) => index < 5 || group.category === selected,
    );
  });

  visibleTransactions = computed(() => {
    const type = this.listFilter();
    const category = this.categoryFilter();

    return this.filteredTransactions().filter(
      (t) =>
        (type === 'all' || t.type === type) &&
        (!category || this.displayCategory(t) === category),
    );
  });

  periodLabel = computed(
    () =>
      this.periods().find((p) => p.value === this.selectedPeriod())?.label ?? '',
  );

  // share of the income+expense total that is income, for the ratio bar
  incomeShare = computed(() => {
    const total = this.totalIncome() + this.totalExpense();

    return total > 0 ? (this.totalIncome() / total) * 100 : 50;
  });

  totalIncome = computed(() =>
    this.sum(this.filteredTransactions().filter((t) => t.type === 'income')),
  );

  totalExpense = computed(() =>
    this.sum(this.filteredTransactions().filter((t) => t.type === 'expense')),
  );

  balance = computed(() => this.totalIncome() - this.totalExpense());


  constructor() {
    this.transactionService.getTransactions().subscribe({
      next: (data) => this.transactions.set(data),
      error: (error) => {
        console.error('Error loading transactions:', error);
        this.toast.show('שגיאה בטעינת התנועות', 'error');
      },
    });
  }

  async logout() {
    try {
      await signOut(this.auth);
      await this.router.navigateByUrl('/login');
    } catch (err) {
      console.error('logout error', err);
      this.toast.show('שגיאה בהתנתקות', 'error');
    }
  }

  async saveTransaction() {
    const amount = Number(this.amount);

    if (this.amount === null || isNaN(amount) || amount <= 0) {
      this.toast.show('אנא הזן סכום חיובי', 'error');
      return;
    }

    const date = fromDateInputValue(this.date);

    if (!date) {
      this.toast.show('אנא בחר תאריך', 'error');
      return;
    }

    const input = {
      type: this.type,
      amount,
      category: this.category,
      description: this.description.trim(),
      date,
    };

    this.saving = true;

    try {
      if (this.editId) {
        await this.transactionService.updateTransaction(this.editId, input);
      } else {
        await this.transactionService.addTransaction(input);
      }

      this.closeSheet();
    } catch (err) {
      console.error('saveTransaction error', err);
      this.toast.show('שגיאה בשמירת התנועה', 'error');
    } finally {
      this.saving = false;
    }
  }

  editTransaction(t: Transaction) {
    if (!t.id) {
      this.toast.show('לא ניתן לערוך תנועה ללא מזהה', 'error');
      return;
    }

    this.editId = t.id;
    this.type = t.type;
    this.amount = t.amount;
    this.category = this.categories.includes(t.category) ? t.category : 'שונות';
    this.description = t.description;
    this.date = toDateInputValue(transactionDate(t) ?? new Date());
    this.sheetOpen = true;
  }

  openNew() {
    this.clearForm();
    this.sheetOpen = true;
  }

  @HostListener('document:keydown.escape')
  closeSheet() {
    this.sheetOpen = false;
    this.clearForm();
  }

  async deleteFromSheet() {
    if (this.editId) {
      const deleted = await this.deleteTransaction(this.editId);

      if (deleted) {
        this.closeSheet();
      }
    }
  }

  // swap the obvious default category when switching between income/expense
  setType(type: TransactionType) {
    this.type = type;

    if (type === 'income' && this.category === 'סופר') {
      this.category = 'משכורת';
    } else if (type === 'expense' && this.category === 'משכורת') {
      this.category = 'סופר';
    }
  }

  toggleCategoryFilter(category: string) {
    this.categoryFilter.update((current) =>
      current === category ? null : category,
    );
  }

  // income counts up, expenses down; a refund is a negative expense
  signedAmount(t: Transaction): number {
    return t.type === 'income' ? Number(t.amount) : -Number(t.amount);
  }

  displayCategory(t: Transaction): string {
    return this.categories.includes(t.category) ? t.category : 'שונות';
  }

  async deleteTransaction(id: string): Promise<boolean> {
    if (!confirm('למחוק את התנועה?')) {
      return false;
    }

    try {
      await this.transactionService.deleteTransaction(id);
      return true;
    } catch (err) {
      console.error('deleteTransaction error', err);
      this.toast.show('שגיאה במחיקה', 'error');
      return false;
    }
  }

  clearForm() {
    this.editId = null;
    this.type = 'expense';
    this.amount = null;
    this.category = 'סופר';
    this.description = '';
    this.date = toDateInputValue(new Date());
  }

  expensePercent(group: CategoryGroup): number {
    const total = this.totalExpense();

    return total > 0 ? (group.expenseTotal / total) * 100 : 0;
  }

  formatDate(t: Transaction): string {
    const d = transactionDate(t);

    if (!d) {
      return '';
    }

    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');

    return `${day}.${month}.${d.getFullYear()}`;
  }

  sourceNote(t: Transaction): string {
    const parts: string[] = [];

    if (t.source === 'leumi-card') {
      parts.push(`ויזה ${t.card ?? ''}`.trim());
    } else if (t.source === 'leumi-account') {
      parts.push('עו"ש');
    } else if (t.source === 'isracard') {
      parts.push(`ישראכרט ${t.card ?? ''}`.trim());
    }

    if (t.installment) {
      parts.push(`תשלום ${t.installment.number}/${t.installment.total}`);
    }

    return parts.join(' · ');
  }

  private periodKey(t: Transaction): string | null {
    const date = transactionDate(t);

    return date ? periodKeyFor(date) : null;
  }

  private createCategoryGroup(
    category: string,
    items: Transaction[],
  ): CategoryGroup {
    const incomeItems = items.filter((t) => t.type === 'income');
    const expenseItems = items.filter((t) => t.type === 'expense');

    return {
      category,
      incomeItems,
      expenseItems,
      incomeTotal: this.sum(incomeItems),
      expenseTotal: this.sum(expenseItems),
    };
  }

  private sum(items: Transaction[]): number {
    return items.reduce((total, t) => total + Number(t.amount), 0);
  }
}
