import { redirect } from 'next/navigation';
import { Landing, returnPath } from '../components/Landing';
import { currentUser } from '../lib/api';

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;
  if (error === undefined && (await currentUser())) redirect(returnPath(next));
  return <Landing error={error} next={next} />;
}
