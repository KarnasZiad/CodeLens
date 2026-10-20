/** Liveness of the dashboard itself, independent of the API (the container health check). */
export function GET() {
  return new Response('ok', {
    headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' },
  });
}
