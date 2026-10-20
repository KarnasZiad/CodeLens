import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
});

// next/image needs the Next.js runtime; a plain img is enough for component tests.
vi.mock('next/image', async () => {
  const { createElement } = await import('react');
  return {
    default: (props: {
      src: string;
      alt: string;
      width: number;
      height: number;
      className?: string;
    }) => createElement('img', props),
  };
});

const router = { replace: vi.fn(), refresh: vi.fn(), push: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router }));
export { router };
