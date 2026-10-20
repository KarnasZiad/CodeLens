import type { Finding } from '../model.js';
import { type Analyzer, scannableLines } from './analyzer.js';

interface SecretRule {
  rule: string;
  label: string;
  pattern: RegExp;
}

// Provider formats are precise enough to be reported everywhere, test files included: a real
// token in a fixture is still a leaked token. Every pattern is linear (no nested quantifiers).
const PROVIDER_RULES: SecretRule[] = [
  {
    rule: 'aws-access-key',
    label: 'Identifiant de clé d’accès AWS',
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  },
  {
    rule: 'github-token',
    label: 'Jeton GitHub',
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{22,255})\b/,
  },
  { rule: 'slack-token', label: 'Jeton Slack', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,250}\b/ },
  { rule: 'stripe-key', label: 'Clé secrète Stripe', pattern: /\b[rs]k_live_[A-Za-z0-9]{24,99}\b/ },
  { rule: 'google-api-key', label: 'Clé d’API Google', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  {
    rule: 'private-key',
    label: 'Clé privée',
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY(?: BLOCK)?-----/,
  },
];

const ASSIGNMENT =
  /\b(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)["']?\s*[:=]\s*["']([^"'\s]{8,200})["']/i;

const PLACEHOLDER =
  /example|sample|changeme|change[_-]?me|placeholder|dummy|fake|redacted|your[_-]|xxx|\*\*\*|<[^>]*>|\$\{|\{\{|%s|process\.env/i;

/** Shannon entropy in bits per character: random secrets score high, words and patterns low. */
export function entropy(value: string): number {
  const counts = new Map<string, number>();
  for (const character of value) counts.set(character, (counts.get(character) ?? 0) + 1);
  let bits = 0;
  for (const count of counts.values()) {
    const probability = count / value.length;
    bits -= probability * Math.log2(probability);
  }
  return bits;
}

function looksLikeSecret(value: string): boolean {
  return !PLACEHOLDER.test(value) && entropy(value) >= 3;
}

const ADVICE =
  'Révoquez-le, puis retirez-le de l’historique Git : le supprimer dans un commit suivant ne suffit pas.';

/** Hard-coded credentials. The finding names the kind of secret and its line, never its value. */
export const secretsAnalyzer: Analyzer = {
  id: 'secrets',
  description: 'Clés, jetons et mots de passe écrits en dur',
  analyze(context) {
    const findings: Finding[] = [];
    for (const file of context.files) {
      for (const { line, content } of scannableLines(file)) {
        const provider = PROVIDER_RULES.find(({ pattern }) => pattern.test(content));
        if (provider) {
          findings.push({
            analyzer: 'secrets',
            rule: provider.rule,
            severity: 'blocker',
            message: `${provider.label} détecté(e). ${ADVICE}`,
            path: file.path,
            line,
          });
          continue;
        }
        // Assignments are noisier: test files are full of fake passwords.
        if (file.isTest) continue;
        const assigned = ASSIGNMENT.exec(content)?.[1];
        if (assigned !== undefined && looksLikeSecret(assigned)) {
          findings.push({
            analyzer: 'secrets',
            rule: 'hardcoded-credential',
            severity: 'blocker',
            message: `Identifiant ou mot de passe écrit en dur. Lisez-le depuis l’environnement ou un coffre de secrets. ${ADVICE}`,
            path: file.path,
            line,
          });
        }
      }
    }
    return findings;
  },
};
