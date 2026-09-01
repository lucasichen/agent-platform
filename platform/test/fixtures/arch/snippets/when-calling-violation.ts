export class AccountService {
  static delete(accountId: string): void {
    // Does not revoke sessions through the canonical seam.
    console.log(`deleted ${accountId}`);
  }
}
