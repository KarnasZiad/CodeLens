'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/** Signs out through the API (same origin), then goes back to the landing page. */
export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Unreachable API: the server-side session still expires on its own.
    } finally {
      router.replace('/');
      router.refresh();
    }
  }

  return (
    <button
      type="button"
      className="btn-secondary"
      disabled={pending}
      onClick={() => void signOut()}
    >
      Déconnexion
    </button>
  );
}
