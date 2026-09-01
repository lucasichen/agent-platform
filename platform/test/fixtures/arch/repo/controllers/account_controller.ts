import { AccountService } from "../services/account/AccountService";

export function handleDeleteRequest(accountId: string): void {
  AccountService.delete(accountId);
}
