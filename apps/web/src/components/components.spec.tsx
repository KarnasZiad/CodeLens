import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { router } from '../../test/setup';
import type { RunDetail, Trends } from '../lib/types';
import { GateBadge, GateStatusBadge, SeverityBadge } from './badges';
import { FindingList } from './FindingList';
import { Landing, returnPath } from './Landing';
import { Shell } from './Shell';
import { SignOutButton } from './SignOutButton';
import { TrendChart } from './TrendChart';

const run: RunDetail = {
  id: 'run-1',
  headSha: 'a'.repeat(40),
  status: 'completed',
  gateStatus: 'failed',
  conclusion: 'failure',
  counts: { blocker: 1, minor: 1 },
  findingsCount: 2,
  partial: false,
  durationMs: 820,
  queuedAt: '2026-10-20T10:00:00.000Z',
  completedAt: '2026-10-20T10:00:01.000Z',
  repository: { id: 1001, fullName: 'acme/shop' },
  pullRequest: { number: 7, title: 'Add the cart', author: 'amina' },
  findings: [
    {
      analyzer: 'secrets',
      rule: 'github-token',
      severity: 'blocker',
      path: 'src/config.ts',
      line: 3,
      endLine: null,
      message: 'Jeton GitHub détecté.',
    },
    {
      analyzer: 'missing-tests',
      rule: 'no-test-change',
      severity: 'minor',
      path: null,
      line: null,
      endLine: null,
      message: 'Code ajouté sans test.',
    },
  ],
};

describe('badges', () => {
  it('labels severities and gates in French', () => {
    render(
      <>
        <SeverityBadge severity="blocker" />
        <GateStatusBadge status="passed" />
        <GateStatusBadge status="failed" />
        <GateStatusBadge status={null} />
      </>,
    );
    expect(screen.getByText('Bloquant')).toBeDefined();
    expect(screen.getByText('Gate réussie')).toBeDefined();
    expect(screen.getByText('Gate en échec')).toBeDefined();
    expect(screen.getByText('—')).toBeDefined();
  });

  it.each([
    [null, 'Jamais analysée'],
    [{ status: 'queued', gateStatus: null, conclusion: null }, 'Analyse en cours'],
    [{ status: 'running', gateStatus: null, conclusion: null }, 'Analyse en cours'],
    [{ status: 'failed', gateStatus: null, conclusion: 'neutral' }, 'Analyse impossible'],
    [{ status: 'completed', gateStatus: null, conclusion: 'neutral' }, 'Configuration invalide'],
    [{ status: 'completed', gateStatus: 'passed', conclusion: 'success' }, 'Gate réussie'],
  ] as const)('shows the state of a review: %o', (state, label) => {
    render(<GateBadge run={state} />);
    expect(screen.getByText(label)).toBeDefined();
  });
});

describe('FindingList', () => {
  it('groups findings by file and links each line to the reviewed commit', () => {
    render(<FindingList run={run} webUrl="https://github.com" />);
    expect(screen.getByRole('heading', { name: 'src/config.ts' })).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Pull request' })).toBeDefined();
    const link = screen.getByRole('link', { name: 'ligne 3' });
    expect(link.getAttribute('href')).toBe(
      `https://github.com/acme/shop/blob/${'a'.repeat(40)}/src/config.ts#L3`,
    );
    expect(link.getAttribute('rel')).toBe('noreferrer');
  });

  it('says so when there is nothing to report', () => {
    render(<FindingList run={{ ...run, findings: [] }} webUrl="https://github.com" />);
    expect(screen.getByText('Aucun constat sur les lignes modifiées.')).toBeDefined();
  });
});

describe('TrendChart', () => {
  const trends: Trends = {
    days: 30,
    weekly: [
      { week: '2026-10-05', analyzer: 'secrets', findings: 2 },
      { week: '2026-10-05', analyzer: 'complexity', findings: 3 },
      { week: '2026-10-12', analyzer: 'complexity', findings: 1 },
    ],
    gate: { passed: 3, failed: 1 },
  };

  it('draws one bar per week, split by analyzer, without inline styles', () => {
    const { container } = render(<TrendChart trends={trends} />);
    expect(screen.getByRole('img', { name: 'Constats par semaine sur 30 jours' })).toBeDefined();
    expect(container.querySelectorAll('svg[role="img"] rect')).toHaveLength(3);
    expect(screen.getByText('Sem. 10/05')).toBeDefined();
    expect(screen.getByText('5')).toBeDefined();
    expect(container.querySelector('[style]')).toBeNull();
    expect(screen.getByText('secrets')).toBeDefined();
  });

  it('says so when the period has no finding', () => {
    render(<TrendChart trends={{ ...trends, weekly: [] }} />);
    expect(screen.getByText('Aucun constat sur les 30 derniers jours.')).toBeDefined();
  });
});

describe('Landing', () => {
  it('starts the sign-in with the page to return to', () => {
    render(<Landing next="/runs/abc" />);
    expect(
      screen.getByRole('link', { name: 'Se connecter avec GitHub' }).getAttribute('href'),
    ).toBe('/api/auth/github/login?redirect=%2Fruns%2Fabc');
  });

  it('explains sign-in errors without echoing unknown codes', () => {
    render(<Landing error="expired" />);
    expect(screen.getByRole('alert').textContent).toBe('La connexion a expiré. Recommencez.');
  });

  it('shows a generic message for an unknown error', () => {
    render(<Landing error="<script>" />);
    expect(screen.getByRole('alert').textContent).toBe('La connexion a échoué.');
  });

  it('only returns to paths of the dashboard', () => {
    expect(returnPath('/repositories/acme/shop')).toBe('/repositories/acme/shop');
    expect(returnPath('//evil.example')).toBe('/repositories');
    expect(returnPath('https://evil.example')).toBe('/repositories');
    expect(returnPath(undefined)).toBe('/repositories');
  });
});

describe('Shell and sign-out', () => {
  it('shows the user and signs out through the API', async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal('fetch', fetch);
    render(
      <Shell
        me={{
          user: { id: 7, login: 'amina', avatarUrl: 'https://avatars.githubusercontent.com/u/7' },
          repositories: 1,
        }}
      >
        <p>contenu</p>
      </Shell>,
    );
    expect(screen.getByText('amina')).toBeDefined();
    expect(screen.getByText('contenu')).toBeDefined();

    await userEvent.click(screen.getByRole('button', { name: 'Déconnexion' }));

    expect(fetch).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST' });
    expect(router.replace).toHaveBeenCalledWith('/');
    expect(router.refresh).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('leaves the page even if the API cannot be reached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('offline'))),
    );
    render(<SignOutButton />);
    await userEvent
      .click(screen.getByRole('button', { name: 'Déconnexion' }))
      .catch(() => undefined);
    expect(router.replace).toHaveBeenCalledWith('/');
    vi.unstubAllGlobals();
  });
});
