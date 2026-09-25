import { Injectable, inject } from '@angular/core';

import {
  Firestore,
  collection,
  addDoc,
  collectionData,
  query,
  orderBy,
  doc,
  updateDoc,
  deleteDoc,
} from '@angular/fire/firestore';

import { Observable, switchMap } from 'rxjs';

import { GroupService } from './group.service';
import { ToastService } from './toast.service';

export type TransactionType = 'income' | 'expense';

// Where a transaction came from; everything except 'manual' is imported
export type TransactionSource = 'manual' | 'leumi' | 'max' | 'isracard';

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
  // id from the bank / card company, used to skip duplicates on import
  externalId?: string;
}

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

  async deleteTransaction(id: string): Promise<void> {
    const path = await this.getTransactionsPath();

    await deleteDoc(doc(this.firestore, `${path}/${id}`));

    this.toast.show('התנועה נמחקה בהצלחה');
  }
}
