import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Me } from '../lib/types';
import { SignOutButton } from './SignOutButton';

/** Frame of the signed-in pages: header with the user, then the page. */
export function Shell({ me, children }: { me: Me; children: ReactNode }) {
  return (
    <>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
          <Link href="/repositories" className="font-semibold">
            CodeLens
          </Link>
          <nav aria-label="Navigation principale" className="text-sm">
            <Link href="/repositories" className="link">
              Dépôts
            </Link>
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <Image src={me.user.avatarUrl} alt="" width={24} height={24} className="rounded-full" />
            <span>{me.user.login}</span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </>
  );
}
