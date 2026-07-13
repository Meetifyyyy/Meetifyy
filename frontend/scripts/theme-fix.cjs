const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '../src/components/crew');

const replacements = [
  { regex: /background:\s*white;/g, replacement: 'background: var(--color-bg-white);' },
  { regex: /background-color:\s*white;/g, replacement: 'background-color: var(--color-bg-white);' },
  { regex: /background:\s*#ffffff;/g, replacement: 'background: var(--color-bg-white);' },
  { regex: /color:\s*#111827;/gi, replacement: 'color: var(--color-text-main);' },
  { regex: /color:\s*#0f172a;/gi, replacement: 'color: var(--color-text-main);' },
  { regex: /color:\s*#4b5563;/gi, replacement: 'color: var(--color-text-light);' },
  { regex: /color:\s*#6b7280;/gi, replacement: 'color: var(--color-text-muted);' },
  { regex: /border:\s*1px solid #f3f4f6;/gi, replacement: 'border: 1px solid var(--color-border-light);' },
  { regex: /border:\s*1px solid #e5e7eb;/gi, replacement: 'border: 1px solid var(--color-border);' },
  { regex: /border-color:\s*#e5e7eb;/gi, replacement: 'border-color: var(--color-border);' },
  { regex: /border-color:\s*#d1d5db;/gi, replacement: 'border-color: var(--color-border-dark);' },
  { regex: /color:\s*#6366f1;/gi, replacement: 'color: var(--color-primary);' },
  { regex: /color:\s*#4f46e5;/gi, replacement: 'color: var(--color-primary-hover);' },
  { regex: /background:\s*#6366f1;/gi, replacement: 'background: var(--color-primary);' },
  { regex: /background:\s*#4f46e5;/gi, replacement: 'background: var(--color-primary-hover);' },
  { regex: /background:\s*#ede9fe;/gi, replacement: 'background: rgba(var(--color-primary-rgb), 0.1);' },
  { regex: /background:\s*#eef2ff;/gi, replacement: 'background: rgba(var(--color-primary-rgb), 0.05);' },
  { regex: /border-radius:\s*16px;/g, replacement: 'border-radius: var(--radius-lg);' },
  { regex: /border-radius:\s*12px;/g, replacement: 'border-radius: var(--radius-md);' },
  { regex: /border-radius:\s*8px;/g, replacement: 'border-radius: var(--radius-sm);' },
  { regex: /box-shadow:\s*0 2px 10px rgba\(0,\s*0,\s*0,\s*0\.02\);/g, replacement: 'box-shadow: var(--shadow-sm);' },
  { regex: /box-shadow:\s*0 4px 20px rgba\(0,\s*0,\s*0,\s*0\.15\);/g, replacement: 'box-shadow: var(--shadow-md);' },
  { regex: /box-shadow:\s*0 8px 24px rgba\(0,\s*0,\s*0,\s*0\.06\);/g, replacement: 'box-shadow: var(--shadow-lg);' }
];

fs.readdirSync(dir).forEach(file => {
  if (file.endsWith('.css')) {
    const filePath = path.join(dir, file);
    let content = fs.readFileSync(filePath, 'utf8');
    let original = content;
    
    replacements.forEach(({ regex, replacement }) => {
      content = content.replace(regex, replacement);
    });

    if (content !== original) {
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`Updated ${file}`);
    }
  }
});
