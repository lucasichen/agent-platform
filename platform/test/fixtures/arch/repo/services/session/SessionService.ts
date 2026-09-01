import { SessionStore } from "../../persistence/session/store";

export class SessionService {
  static revokeAll(accountId: string): void {
    SessionStore.revoke(accountId);
  }
}
