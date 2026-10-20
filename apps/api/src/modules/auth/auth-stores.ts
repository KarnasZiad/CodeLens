/** A sign-in in progress, bound to the browser by the OAuth state cookie. */
export interface PendingSignIn {
  codeVerifier: string;
  redirect: string;
}

export interface PendingSignInStore {
  put(state: string, pending: PendingSignIn, ttlSeconds: number): Promise<void>;
  /** Single use: a state can complete at most one sign-in. */
  take(state: string): Promise<PendingSignIn | null>;
}
