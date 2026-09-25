import { Injectable, inject } from '@angular/core';
import { Auth, authState, User } from '@angular/fire/auth';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';
import { Observable, filter, firstValueFrom, switchMap, take } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class GroupService {
  private firestore = inject(Firestore);
  private auth = inject(Auth);

  // groupId per user, so every write doesn't re-read userGroups/{uid}
  private groupIdCache = new Map<string, Promise<string>>();

  // Emits the current user's groupId whenever the signed-in user changes
  readonly groupId$: Observable<string> = authState(this.auth).pipe(
    filter((user): user is User => user !== null),
    switchMap((user) => this.getGroupIdForUser(user)),
  );

  async getGroupId(): Promise<string> {
    const user = await firstValueFrom(
      authState(this.auth).pipe(
        filter((user): user is User => user !== null),
        take(1),
      ),
    );

    return this.getGroupIdForUser(user);
  }

  async getMonthStartDay(): Promise<number> {
    const groupId = await this.getGroupId();

    const groupSnapshot = await getDoc(doc(this.firestore, `groups/${groupId}`));

    if (!groupSnapshot.exists()) {
      throw new Error('מסמך הקבוצה לא נמצא');
    }

    const monthStartDay = groupSnapshot.data()?.['monthStartDay'];

    if (
      typeof monthStartDay !== 'number' ||
      monthStartDay < 1 ||
      monthStartDay > 28
    ) {
      return 1;
    }

    return monthStartDay;
  }

  private getGroupIdForUser(user: User): Promise<string> {
    let groupId = this.groupIdCache.get(user.uid);

    if (!groupId) {
      groupId = this.fetchGroupId(user);
      this.groupIdCache.set(user.uid, groupId);
      // don't cache failures, so the next call retries
      groupId.catch(() => this.groupIdCache.delete(user.uid));
    }

    return groupId;
  }

  private async fetchGroupId(user: User): Promise<string> {
    const userGroupSnapshot = await getDoc(
      doc(this.firestore, `userGroups/${user.uid}`),
    );

    if (!userGroupSnapshot.exists()) {
      throw new Error(`לא נמצאה קבוצה עבור המשתמש: ${user.uid}`);
    }

    const groupId = userGroupSnapshot.data()?.['groupId'];

    if (!groupId || typeof groupId !== 'string') {
      throw new Error('הגדרת הקבוצה אינה תקינה');
    }

    return groupId;
  }
}
