import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';

import { CATEGORIES, categoryIcon } from '../../categories';
import { categorize } from '../../import/categorize';
import { ParsedTransaction, parseStatement } from '../../import/parsers';
import { readWorkbookRows } from '../../import/read-workbook';
import { TransactionService } from '../../services/transaction.service';
import { ToastService } from '../../services/toast.service';

interface PreviewRow extends ParsedTransaction {
  fileName: string;
  category: string;
  include: boolean;
}

interface FileSummary {
  name: string;
  format: string | null;
  count: number;
  // rows already in the preview from a file chosen earlier
  alreadyListed: number;
}

@Component({
  selector: 'app-import',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './import.component.html',
  styleUrl: './import.component.css',
})
export class ImportComponent {
  private transactionService = inject(TransactionService);
  private toast = inject(ToastService);

  categories = CATEGORIES;
  categoryIcon = categoryIcon;

  files = signal<FileSummary[]>([]);
  rows = signal<PreviewRow[]>([]);
  reading = false;
  importing = false;

  includedCount = computed(() => this.rows().filter((r) => r.include).length);

  async onFilesSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const selected = [...(input.files ?? [])];
    input.value = '';

    if (selected.length === 0) {
      return;
    }

    this.reading = true;

    try {
      // loaded on demand: SheetJS is large and only this page needs it
      const XLSX = await import('xlsx');

      const summaries: FileSummary[] = [];
      const rows: PreviewRow[] = [];
      const listed = new Set(this.rows().map((r) => r.dedupeKey));

      for (const file of selected) {
        const result = parseStatement(
          readWorkbookRows(XLSX, await file.arrayBuffer()),
          file.name,
        );

        const fresh = (result?.transactions ?? []).filter(
          (t) => !listed.has(t.dedupeKey),
        );

        summaries.push({
          name: file.name,
          format: result?.format ?? null,
          count: fresh.length,
          alreadyListed: (result?.transactions.length ?? 0) - fresh.length,
        });

        for (const t of fresh) {
          listed.add(t.dedupeKey);
          rows.push({
            ...t,
            fileName: file.name,
            category: categorize(t.description, t.type),
            include: !t.skipReason,
          });
        }
      }

      this.files.update((existing) => [...existing, ...summaries]);
      this.rows.update((existing) =>
        [...existing, ...rows].sort((a, b) => b.date.getTime() - a.date.getTime()),
      );
    } catch (err) {
      console.error('import read error', err);
      this.toast.show('לא הצלחתי לקרוא את הקובץ', 'error');
    } finally {
      this.reading = false;
    }
  }

  // rows are mutated in place by ngModel; re-emit so computed() updates
  touch() {
    this.rows.update((rows) => [...rows]);
  }

  clear() {
    this.files.set([]);
    this.rows.set([]);
  }

  async import() {
    const selected = this.rows().filter((r) => r.include);

    if (selected.length === 0) {
      return;
    }

    this.importing = true;

    try {
      const { added, duplicates } =
        await this.transactionService.importTransactions(
          selected.map((r) => ({
            type: r.type,
            amount: r.amount,
            category: r.category,
            description: r.description,
            date: r.date,
            source: r.source,
            card: r.card,
            installment: r.installment,
            dedupeKey: r.dedupeKey,
          })),
        );

      this.toast.show(
        duplicates > 0
          ? `יובאו ${added} תנועות (${duplicates} כבר היו קיימות)`
          : `יובאו ${added} תנועות`,
      );
      this.clear();
    } catch (err) {
      console.error('import error', err);
      this.toast.show('שגיאה בייבוא התנועות', 'error');
    } finally {
      this.importing = false;
    }
  }

  sourceLabel(row: PreviewRow): string {
    if (row.source === 'leumi-card') {
      return `ויזה ${row.card ?? ''}`.trim();
    }

    return 'עו"ש';
  }

  formatDate(date: Date): string {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');

    return `${day}.${month}.${date.getFullYear()}`;
  }
}
