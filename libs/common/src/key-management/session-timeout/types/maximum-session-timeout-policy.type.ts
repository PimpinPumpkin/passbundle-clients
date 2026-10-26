import { SessionTimeoutAction, SessionTimeoutType } from "./session-timeout.type";

export interface MaximumSessionTimeoutPolicyData {
  type?: SessionTimeoutType;
  minutes: number;
  action?: SessionTimeoutAction;
  /**
   * Keykeeper: with "onSystemLock", the web vault's longest wait in minutes,
   * since a web page can't see the computer lock (15 when missing). Other
   * clients ignore it. See keykeeper-system-lock.ts.
   */
  webMinutes?: number;
}
