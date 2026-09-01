import { AccountService } from "../../services/account/AccountService";

export function deleteAccount(accountId: string): void {
  AccountService.delete(accountId);
}
