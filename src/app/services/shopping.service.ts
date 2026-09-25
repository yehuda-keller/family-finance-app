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

export interface ShoppingItem {
  id?: string;
  name: string;
  quantity: number;
  createdAt: Date;
}

@Injectable({
  providedIn: 'root',
})
export class ShoppingService {
  private firestore = inject(Firestore);
  private groupService = inject(GroupService);
  private toast = inject(ToastService);

  private async getShoppingItemsPath(): Promise<string> {
    const groupId = await this.groupService.getGroupId();

    return `groups/${groupId}/shoppingItems`;
  }

  getItems(): Observable<ShoppingItem[]> {
    return this.groupService.groupId$.pipe(
      switchMap((groupId) => {
        const itemsRef = collection(
          this.firestore,
          `groups/${groupId}/shoppingItems`,
        );

        const itemsQuery = query(itemsRef, orderBy('createdAt', 'desc'));

        return collectionData(itemsQuery, {
          idField: 'id',
        }) as Observable<ShoppingItem[]>;
      }),
    );
  }

  async addItem(name: string, quantity: number): Promise<void> {
    const path = await this.getShoppingItemsPath();
    const itemsRef = collection(this.firestore, path);

    await addDoc(itemsRef, {
      name,
      quantity: Number(quantity),
      createdAt: new Date(),
    });

    this.toast.show('המוצר נוסף לרשימה');
  }

  async updateItem(id: string, name: string, quantity: number): Promise<void> {
    const path = await this.getShoppingItemsPath();
    const itemRef = doc(this.firestore, `${path}/${id}`);

    await updateDoc(itemRef, {
      name,
      quantity: Number(quantity),
    });

    this.toast.show('המוצר עודכן');
  }

  async deleteItem(id: string): Promise<void> {
    const path = await this.getShoppingItemsPath();
    const itemRef = doc(this.firestore, `${path}/${id}`);

    await deleteDoc(itemRef);

    this.toast.show('המוצר נמחק');
  }
}
