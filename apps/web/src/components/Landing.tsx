const ERRORS: Record<string, string> = {
  access_denied: 'Connexion annulée sur GitHub.',
  state: 'La connexion n’a pas pu être vérifiée. Recommencez depuis cette page.',
  expired: 'La connexion a expiré. Recommencez.',
  oauth: 'GitHub a refusé la connexion. Recommencez dans un instant.',
};

/** Only paths of the dashboard are kept after sign-in. */
export function returnPath(next: string | undefined): string {
  return next?.startsWith('/') && !next.startsWith('//') ? next : '/repositories';
}

export function Landing({ error, next }: { error?: string; next?: string }) {
  const message = error === undefined ? undefined : (ERRORS[error] ?? 'La connexion a échoué.');
  const login = `/api/auth/github/login?redirect=${encodeURIComponent(returnPath(next))}`;
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 px-6">
      <div>
        <p className="text-3xl font-semibold text-slate-900">CodeLens</p>
        <h1 className="mt-2 text-lg text-slate-600">
          Revue de code automatisée : secrets, injections SQL, débogage oublié, complexité et
          quality gate sur chaque pull request.
        </h1>
      </div>
      {message ? (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {message}
        </p>
      ) : null}
      <a href={login} className="btn-primary self-start">
        Se connecter avec GitHub
      </a>
      <p className="text-sm text-slate-500">
        Vous ne verrez que les dépôts auxquels vous avez accès sur GitHub et où l’application
        CodeLens est installée.
      </p>
    </main>
  );
}
