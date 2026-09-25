import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class ToastService {
  message: string | null = null;
  type: 'success' | 'error' = 'success';
  private timeoutId: any;

  show(message: string, type: 'success' | 'error' = 'success') {
    this.message = message;
    this.type = type;

    clearTimeout(this.timeoutId);

    this.timeoutId = setTimeout(() => {
      this.message = null;
    }, 2500);
  }
}
