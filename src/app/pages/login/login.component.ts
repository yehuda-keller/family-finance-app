import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css',
})
export class LoginComponent {
  authService = inject(AuthService);
  router = inject(Router);
  private toast = inject(ToastService);

  email = '';
  password = '';
  loading = false;

  async login() {
    this.loading = true;

    try {
      await this.authService.login(this.email.trim(), this.password);

      this.router.navigate(['/dashboard']);
    } catch (error) {
      this.toast.show('אימייל או סיסמה שגויים', 'error');
    } finally {
      this.loading = false;
    }
  }
}
