import { Injectable, inject } from '@angular/core';

import {
  Firestore,
  collection,
  addDoc,
  collectionData,
  query,
  orderBy,
  doc,
  getDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
} from '@angular/fire/firestore';

import { Observable, switchMap } from 'rxjs';

import { GroupService } from './group.service';
import { ToastService } from './toast.service';

export type TransactionType = 'income' | 'expense';

// Where a transaction came from; everything except 'manual' is imported
export type TransactionSource =
  | 'manual'
  | 'leumi-account'
  | 'leumi-card'
  | 'isracard';

// Firestore returns Timestamp objects; new code writes Date
export type FirestoreDate = Date | { seconds: number; nanoseconds: number };

export interface Transaction {
  id?: string;
  type: TransactionType;
  amount: number;
  category: string;
  description: string;
  // when the money actually moved; older docs only have createdAt
  date?: FirestoreDate;
  createdAt: FirestoreDate;
  source?: TransactionSource;
  // last 4 digits, for card transactions
  card?: string;
  installment?: { number: number; total: number };
}

export type ImportedTransactionInput = TransactionInput &
  Pick<Transaction, 'source' | 'card' | 'installment'> & {
    // stable content key; hashed into the doc id so re-imports are no-ops
    dedupeKey: string;
  };

export type TransactionInput = Pick<
  Transaction,
  'type' | 'amount' | 'category' | 'description'
> & { date: Date };

export function toDate(value: FirestoreDate | undefined | null): Date | null {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value;
  }

  return new Date(value.seconds * 1000);
}

export function transactionDate(t: Transaction): Date | null {
  return toDate(t.date) ?? toDate(t.createdAt);
}

async function hashId(key: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(key),
  );

  return [...new Uint8Array(digest)]
    .slice(0, 16)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

@Injectable({
  providedIn: 'root',
})
export class TransactionService {
  private firestore = inject(Firestore);
  private groupService = inject(GroupService);
  private toast = inject(ToastService);

  private async getTransactionsPath(): Promise<string> {
    const groupId = await this.groupService.getGroupId();

    return `groups/${groupId}/transactions`;
  }

  getTransactions(): Observable<Transaction[]> {
    return this.groupService.groupId$.pipe(
      switchMap((groupId) => {
        const transactionsRef = collection(
          this.firestore,
          `groups/${groupId}/transactions`,
        );

        // ordered by createdAt because older docs have no `date` field,
        // and Firestore drops docs missing the orderBy field
        const transactionsQuery = query(
          transactionsRef,
          orderBy('createdAt', 'desc'),
        );

        return collectionData(transactionsQuery, {
          idField: 'id',
        }) as Observable<Transaction[]>;
      }),
    );
  }

  async addTransaction(input: TransactionInput): Promise<void> {
    const path = await this.getTransactionsPath();

    await addDoc(collection(this.firestore, path), {
      ...input,
      amount: Number(input.amount),
      source: 'manual',
      createdAt: new Date(),
    });

    this.toast.show('התנועה נוספה בהצלחה');
  }

  async updateTransaction(id: string, input: TransactionInput): Promise<void> {
    const path = await this.getTransactionsPath();

    await updateDoc(doc(this.firestore, `${path}/${id}`), {
      ...input,
      amount: Number(input.amount),
    });

    this.toast.show('התנועה עודכנה בהצלחה');
  }

  // Returns how many were new; rows imported before are left untouched,
  // so categories the user fixed by hand aren't overwritten
  async importTransactions(
    items: ImportedTransactionInput[],
  ): Promise<{ added: number; duplicates: number }> {
    const path = await this.getTransactionsPath();

    const withIds = await Promise.all(
      items.map(async (item) => ({ item, id: await hashId(item.dedupeKey) })),
    );

    const exists = await Promise.all(
      withIds.map(({ id }) =>
        getDoc(doc(this.firestore, `${path}/${id}`)).then((snap) => snap.exists()),
      ),
    );

    const fresh = withIds.filter((_, index) => !exists[index]);
    const createdAt = new Date();

    // Firestore batches are limited to 500 writes
    for (let start = 0; start < fresh.length; start += 500) {
      const batch = writeBatch(this.firestore);

      for (const { item, id } of fresh.slice(start, start + 500)) {
        const { dedupeKey, ...data } = item;

        batch.set(doc(this.firestore, `${path}/${id}`), {
          // Firestore rejects undefined fields
          ...Object.fromEntries(
            Object.entries(data).filter(([, value]) => value !== undefined),
          ),
          createdAt,
        });
      }

      await batch.commit();
    }

    return { added: fresh.length, duplicates: items.length - fresh.length };
  }

  async deleteTransaction(id: string): Promise<void> {
    const path = await this.getTransactionsPath();

    await deleteDoc(doc(this.firestore, `${path}/${id}`));

    this.toast.show('התנועה נמחקה בהצלחה');
  }
}
