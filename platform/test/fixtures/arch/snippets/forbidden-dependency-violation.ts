import { SessionStore } from "../persistence/session/store";

export function badControllerBypass(accountId: string): void {
  SessionStore.revoke(accountId);
}
