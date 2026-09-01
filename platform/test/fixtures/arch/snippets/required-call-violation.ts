import { AccountRepository } from "../services/account/AccountRepository";

export function deleteAccount(accountId: string): void {
  // Bypasses the canonical deletion seam entirely.
  AccountRepository.updateStatus(accountId, "deleted");
}
