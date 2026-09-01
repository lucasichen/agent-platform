import { SessionService } from "../session/SessionService";

export class AccountService {
  static delete(accountId: string): void {
    SessionService.revokeAll(accountId);
  }
}
