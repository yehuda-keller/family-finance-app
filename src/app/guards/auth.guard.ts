import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Auth, authState } from '@angular/fire/auth';
import { map, take } from 'rxjs';

// authState's first emission comes after Firebase restores the saved session,
// so a logged-in user isn't bounced to /login on refresh
export const authGuard: CanActivateFn = () => {
  const auth = inject(Auth);
  const router = inject(Router);

  return authState(auth).pipe(
    take(1),
    map((user) => (user ? true : router.createUrlTree(['/login']))),
  );
};
