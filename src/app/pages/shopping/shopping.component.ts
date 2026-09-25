import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';

import { ShoppingService, ShoppingItem } from '../../services/shopping.service';
import { ToastService } from '../../services/toast.service';

@Component({
  selector: 'app-shopping',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './shopping.component.html',
  styleUrl: './shopping.component.css',
})
export class ShoppingComponent {
  shoppingService = inject(ShoppingService);
  private toast = inject(ToastService);

  items: ShoppingItem[] = [];

  name = '';
  quantity = 1;

  editId: string | null = null;

  constructor() {
    this.shoppingService.getItems().subscribe({
      next: (data) => {
        this.items = data;
      },
      error: (error) => {
        console.error('Error loading shopping items:', error);
      },
    });
  }

  async saveItem() {
    if (!this.name.trim()) {
      this.toast.show('הכנס שם מוצר', 'error');
      return;
    }

    if (!this.quantity || this.quantity < 1) {
      this.toast.show('הכנס כמות תקינה', 'error');
      return;
    }

    try {
      if (this.editId) {
        await this.shoppingService.updateItem(
          this.editId,
          this.name,
          this.quantity,
        );
      } else {
        await this.shoppingService.addItem(this.name, this.quantity);
      }

      this.cancelEdit();
    } catch (err) {
      console.error('saveItem error', err);
      this.toast.show('שגיאה בשמירת המוצר', 'error');
    }
  }

  editItem(item: ShoppingItem) {
    if (!item.id) {
      return;
    }

    this.editId = item.id;
    this.name = item.name;
    this.quantity = item.quantity;
  }

  async deleteItem(id: string) {
    const ok = confirm('למחוק את המוצר מהרשימה?');

    if (!ok) {
      return;
    }

    try {
      await this.shoppingService.deleteItem(id);
    } catch (err) {
      console.error('deleteItem error', err);
      this.toast.show('שגיאה במחיקת המוצר', 'error');
    }
  }

  clearForm() {
    this.name = '';
    this.quantity = 1;
  }

  changeQuantity(delta: number) {
    this.quantity = Math.max(1, (Number(this.quantity) || 1) + delta);
  }

  cancelEdit() {
    this.editId = null;
    this.clearForm();
  }
}
