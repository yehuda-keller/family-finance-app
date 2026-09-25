import { Component, NgZone, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  NavigationEnd,
  Router,
  RouterLink,
  RouterLinkActive,
  RouterOutlet,
} from '@angular/router';
import { CommonModule } from '@angular/common';
import { filter, map } from 'rxjs';

import { ToastService } from './services/toast.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, CommonModule],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
})
export class AppComponent {
  lastError: string | null = null;

  toastService = inject(ToastService);
  private router = inject(Router);

  showNav = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map((event) => !event.urlAfterRedirects.startsWith('/login')),
    ),
    { initialValue: false },
  );

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
