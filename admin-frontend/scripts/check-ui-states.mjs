// Static regression guard for selection styles that change control dimensions,
// and for multiple competing focus treatments. No browser or API access needed.
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const indexCss = readFileSync(resolve(root, 'src/index.css'), 'utf8');
const appCss = readFileSync(resolve(root, 'src/App.css'), 'utf8');
const legalCss = readFileSync(resolve(root, 'src/pages/legal/legal.css'), 'utf8');
const weight = (name) => indexCss.match(new RegExp(`\\.${name}\\s*\\{[^}]*font-weight:\\s*([^;]+);`))?.[1];
if (!weight('btn-primary') || weight('btn-primary') !== weight('btn-secondary')) {
  failures.push('Primary and secondary buttons must use the same font weight to keep selection widths stable.');
}

const focusSelector = appCss.split('\n').find((line) => line.startsWith(':where(button')) || '';
const excludedFocusClasses = focusSelector.match(/:not\(:where\(([^)]+)\)\)/)?.[1].split(',').map((name) => name.trim()) || [];
for (const css of [indexCss, appCss, legalCss]) {
  for (const rule of css.matchAll(/\.([\w-]+):focus\s*\{([^}]+)\}/g)) {
    if (rule[2].includes('border-color:') && rule[2].includes('box-shadow:') && !excludedFocusClasses.includes(`.${rule[1]}`)) {
      failures.push(`${rule[1]} already owns a focus treatment; exclude it from the global outline.`);
    }
  }
}

// Every dialog family shares one responsive corner token.
const viewerCss = readFileSync(resolve(root, 'src/components/MediaViewer.css'), 'utf8');
for (const css of [indexCss, appCss, viewerCss]) {
  for (const rule of css.matchAll(/\.(?:modal-content|logo-crop|media-viewer-dialog)\s*\{([^}]+)\}/g)) {
    const radius = rule[1].match(/border-radius:\s*([^;]+);/)?.[1];
    if (radius && radius !== 'var(--radius-dialog)') failures.push('Dialog surfaces must use the shared --radius-dialog token.');
  }
}

let count = 0;
function scan(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) { scan(path); continue; }
    if (!entry.name.endsWith('.tsx')) continue;
    count++;
    const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    function visit(node) {
      if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(source) === 'select' && relative(root, path) !== 'src/components/Dropdown.tsx') {
        failures.push(`${relative(root, path)}: use the shared Dropdown instead of a one-off native select.`);
      }
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const className = node.attributes.properties.find((prop) => ts.isJsxAttribute(prop) && prop.name.getText(source) === 'className');
        if (className?.initializer && ts.isStringLiteral(className.initializer)) {
          const classes = className.initializer.text.split(/\s+/);
          if (classes.includes('modal-content') && !classes.some((name) => ['dialog-form', 'confirm-dialog', 'legal-modal'].includes(name))) {
            failures.push(`${relative(root, path)}: choose a shared form or sectioned dialog layout.`);
          }
        }
      }
      if (ts.isPropertyAssignment(node) && node.name.getText(source) === 'fontWeight' && ts.isConditionalExpression(node.initializer)) {
        const { whenTrue, whenFalse } = node.initializer;
        if (whenTrue.getText(source) !== whenFalse.getText(source)) {
          const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
          failures.push(`${relative(root, path)}:${line + 1}: state-dependent font weight can resize controls; use a stable weight.`);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
}
scan(resolve(root, 'src'));
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`UI state checks passed across ${count} TSX files and shared/editor focus styles.`);
}
