'use client';

/** Unexpected errors, the API being unreachable above all: no detail is shown to the user. */
export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 px-6">
      <h1 className="text-xl font-semibold">CodeLens est momentanément indisponible</h1>
      <p className="text-slate-600">Réessayez dans quelques instants.</p>
      <button type="button" className="btn-primary self-start" onClick={reset}>
        Réessayer
      </button>
    </main>
  );
}
