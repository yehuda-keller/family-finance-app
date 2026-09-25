import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';

// Global error handlers to capture runtime issues when navigating
window.addEventListener('error', (ev: ErrorEvent) => {
  // print to console for easier debugging in DevTools / terminal
  console.error('Global error:', ev.message, ev.error);
  try {
    const msg =
      ev.message || (ev.error && ev.error.message) || String(ev.error || ev);
    // expose on window and dispatch an event for in-app listeners
    (window as any).__lastAppError = msg;
    window.dispatchEvent(new CustomEvent('app-error', { detail: msg }));
  } catch (e) {
    // ignore
  }
});

window.addEventListener('unhandledrejection', (ev: any) => {
  console.error('Unhandled promise rejection:', ev?.reason || ev);
  try {
    const msg =
      (ev && ev.reason && ev.reason.message) ||
      String(ev && ev.reason ? ev.reason : ev);
    (window as any).__lastAppError = msg;
    window.dispatchEvent(new CustomEvent('app-error', { detail: msg }));
  } catch (e) {
    // ignore
  }
});

bootstrapApplication(AppComponent, appConfig).catch((err) =>
  console.error(err),
);
