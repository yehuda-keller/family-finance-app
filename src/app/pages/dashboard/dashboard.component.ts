import {
  Component,
  ElementRef,
  ViewChild,
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

import { GroupService } from '../../services/group.service';
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
  private groupService = inject(GroupService);
  private toast = inject(ToastService);

  @ViewChild('formSection') formSection?: ElementRef<HTMLElement>;

  categories = [
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

  monthStartDay = signal(1);
  transactions = signal<Transaction[]>([]);
  selectedPeriod = signal<string>(this.periodKeyFor(new Date(), 'expense'));

  type: TransactionType = 'expense';
  amount: number | null = null;
  category = 'סופר';
  description = '';
  date = toDateInputValue(new Date());

  editId: string | null = null;
  saving = false;

  // every period that has transactions, plus the current one, newest first
  periods = computed(() => {
    const keys = new Set<string>([this.periodKeyFor(new Date(), 'expense')]);

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
    this.transactionsByCategory().filter((group) => group.expenseTotal > 0),
  );

  totalIncome = computed(() =>
    this.sum(this.filteredTransactions().filter((t) => t.type === 'income')),
  );

  totalExpense = computed(() =>
    this.sum(this.filteredTransactions().filter((t) => t.type === 'expense')),
  );

  balance = computed(() => this.totalIncome() - this.totalExpense());

  incomeBarWidth = computed(
    () =>
      (this.totalIncome() /
        Math.max(this.totalIncome(), this.totalExpense(), 1)) *
      100,
  );

  expenseBarWidth = computed(
    () =>
      (this.totalExpense() /
        Math.max(this.totalIncome(), this.totalExpense(), 1)) *
      100,
  );

  constructor() {
    this.groupService
      .getMonthStartDay()
      .then((day) => {
        this.monthStartDay.set(day);
        this.selectedPeriod.set(this.periodKeyFor(new Date(), 'expense'));
      })
      .catch((error) => {
        console.error('Error loading month start day:', error);
        this.selectedPeriod.set(this.periodKeyFor(new Date(), 'expense'));
      });

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

      this.clearForm();
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

    this.formSection?.nativeElement.scrollIntoView({ behavior: 'smooth' });
  }

  async deleteTransaction(id: string) {
    if (!confirm('למחוק את התנועה?')) {
      return;
    }

    try {
      await this.transactionService.deleteTransaction(id);
    } catch (err) {
      console.error('deleteTransaction error', err);
      this.toast.show('שגיאה במחיקה', 'error');
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

  private periodKey(t: Transaction): string | null {
    const date = transactionDate(t);

    return date ? this.periodKeyFor(date, t.type) : null;
  }

  // 'YYYY-MM' of the budget month. Expenses before monthStartDay
  // belong to the previous month (billing cycle); income doesn't shift.
  private periodKeyFor(date: Date, type: TransactionType): string {
    let year = date.getFullYear();
    let month = date.getMonth() + 1;

    if (type === 'expense' && date.getDate() < this.monthStartDay()) {
      month -= 1;

      if (month === 0) {
        month = 12;
        year -= 1;
      }
    }

    return `${year}-${String(month).padStart(2, '0')}`;
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
