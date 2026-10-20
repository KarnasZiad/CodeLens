import ts from 'typescript';
import type { Finding } from '../model.js';
import { type Analyzer, type AnalyzedFile } from './analyzer.js';

export interface FunctionComplexity {
  name: string;
  complexity: number;
  startLine: number;
  endLine: number;
}

const SCRIPT_KINDS: Record<string, ts.ScriptKind> = {
  ts: ts.ScriptKind.TS,
  mts: ts.ScriptKind.TS,
  cts: ts.ScriptKind.TS,
  tsx: ts.ScriptKind.TSX,
  js: ts.ScriptKind.JS,
  mjs: ts.ScriptKind.JS,
  cjs: ts.ScriptKind.JS,
  jsx: ts.ScriptKind.JSX,
};

function scriptKind(path: string): ts.ScriptKind | undefined {
  const extension = /\.([a-z]+)$/i.exec(path)?.[1]?.toLowerCase();
  return extension ? SCRIPT_KINDS[extension] : undefined;
}

const LOGICAL_OPERATORS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
]);

/** One decision point per branch: conditions, loops, cases, catch clauses and short-circuits. */
function isDecisionPoint(node: ts.Node): boolean {
  switch (node.kind) {
    case ts.SyntaxKind.IfStatement:
    case ts.SyntaxKind.ConditionalExpression:
    case ts.SyntaxKind.ForStatement:
    case ts.SyntaxKind.ForInStatement:
    case ts.SyntaxKind.ForOfStatement:
    case ts.SyntaxKind.WhileStatement:
    case ts.SyntaxKind.DoStatement:
    case ts.SyntaxKind.CaseClause:
    case ts.SyntaxKind.CatchClause:
      return true;
    case ts.SyntaxKind.BinaryExpression:
      return LOGICAL_OPERATORS.has((node as ts.BinaryExpression).operatorToken.kind);
    default:
      return false;
  }
}

type FunctionNode = ts.FunctionLikeDeclaration & { body: ts.Node };

function isFunctionWithBody(node: ts.Node): node is FunctionNode {
  return (
    (ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isConstructorDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node)) &&
    node.body !== undefined
  );
}

function functionName(node: FunctionNode, sourceFile: ts.SourceFile): string {
  if (ts.isConstructorDeclaration(node)) return 'constructor';
  if (node.name) return node.name.getText(sourceFile);
  // const handler = () => { ... }  /  { onClick: function () { ... } }
  const parent = node.parent;
  if (ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent)) {
    return parent.name.getText(sourceFile);
  }
  return '<anonyme>';
}

/** Complexity of a function body, nested functions excluded: they are measured on their own. */
function measure(body: ts.Node): number {
  let complexity = 1;
  const visit = (node: ts.Node): void => {
    if (isFunctionWithBody(node)) return;
    if (isDecisionPoint(node)) complexity += 1;
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(body, visit);
  return complexity;
}

/**
 * Cyclomatic complexity (McCabe) of every function, computed on the syntax tree only: the code is
 * neither type-checked nor executed, and imports are never resolved.
 */
export function functionComplexities(path: string, content: string): FunctionComplexity[] {
  const kind = scriptKind(path);
  if (kind === undefined) return [];
  const sourceFile = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, kind);
  const results: FunctionComplexity[] = [];
  const lineOf = (position: number) => sourceFile.getLineAndCharacterOfPosition(position).line + 1;

  const visit = (node: ts.Node): void => {
    if (isFunctionWithBody(node)) {
      results.push({
        name: functionName(node, sourceFile),
        complexity: measure(node.body),
        startLine: lineOf(node.getStart(sourceFile)),
        endLine: lineOf(node.getEnd()),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return results;
}

function eligible(file: AnalyzedFile): boolean {
  return (
    !file.isTest &&
    file.added.length > 0 &&
    (file.language === 'typescript' || file.language === 'javascript')
  );
}

/** Functions that the pull request touches and that went over the configured threshold. */
export const complexityAnalyzer: Analyzer = {
  id: 'complexity',
  description: 'Complexité cyclomatique des fonctions modifiées',
  needsContent: eligible,
  analyze(context) {
    const { threshold } = context.config.analyzers.complexity;
    const findings: Finding[] = [];

    for (const file of context.files) {
      if (!eligible(file)) continue;
      const content = context.content(file.path);
      if (content === undefined) continue;
      const touched = new Set(file.added.map((line) => line.line));

      for (const fn of functionComplexities(file.path, content)) {
        if (fn.complexity <= threshold) continue;
        let changed = false;
        for (let line = fn.startLine; line <= fn.endLine && !changed; line += 1) {
          changed = touched.has(line);
        }
        if (!changed) continue;
        findings.push({
          analyzer: 'complexity',
          rule: 'cyclomatic-complexity',
          severity: 'major',
          message: `La fonction « ${fn.name} » a une complexité cyclomatique de ${fn.complexity} (seuil : ${threshold}). Extrayez des fonctions ou simplifiez les conditions.`,
          path: file.path,
          line: fn.startLine,
          endLine: fn.endLine,
        });
      }
    }
    return findings;
  },
};
