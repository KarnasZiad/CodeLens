import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 px-6">
      <h1 className="text-xl font-semibold">Introuvable</h1>
      <p className="text-slate-600">
        Cette page n’existe pas, ou concerne un dépôt auquel vous n’avez pas accès sur GitHub.
      </p>
      <Link href="/repositories" className="link">
        Retour aux dépôts
      </Link>
    </main>
  );
}
