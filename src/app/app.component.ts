import { Component, NgZone, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';

import { ToastService } from './services/toast.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, CommonModule],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
})
export class AppComponent {
  lastError: string | null = null;

  toastService = inject(ToastService);

  constructor(private ngZone: NgZone) {
    window.addEventListener('app-error', (ev: any) => {
      try {
        const msg = ev && ev.detail ? ev.detail : String(ev || 'error');

        this.ngZone.run(() => {
          this.lastError = msg;
        });
      } catch (e) {}
    });
  }

  dismissError() {
    this.lastError = null;

    try {
      (window as any).__lastAppError = null;
    } catch (e) {}
  }
}
