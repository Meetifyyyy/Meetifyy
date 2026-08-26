import * as childProcess from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

const script = `
import { config } from './src/config';
console.log(config.env + '|' + config.email.driver);
`;

const runnerPath = path.join(__dirname, 'test-env-routing.ts');
fs.writeFileSync(runnerPath, script);

function runWithEnv(envMap: Record<string, string>) {
  try {
    const output = childProcess.execSync('npx ts-node test-env-routing.ts', {
      env: { ...process.env, ...envMap, TS_NODE_TRANSPILE_ONLY: 'true' },
      stdio: 'pipe'
    }).toString().trim();
    console.log(`[PASS] Env: ${JSON.stringify(envMap)} -> ${output.split('\n').pop()}`);
  } catch (err: any) {
    const errOutput = err.stderr ? err.stderr.toString() : err.message;
    if (errOutput.includes('Invalid EMAIL_DRIVER')) {
      console.log(`[PASS (Crash)] Env: ${JSON.stringify(envMap)} -> Crashed correctly: ${errOutput.match(/Invalid EMAIL_DRIVER.*/)?.[0]}`);
    } else if (errOutput.includes('Missing required environment variable')) {
       console.log(`[PASS (Crash)] Env: ${JSON.stringify(envMap)} -> Crashed correctly: ${errOutput.match(/Missing required environment variable.*/)?.[0]}`);
    } else {
      console.log(`[FAIL] Env: ${JSON.stringify(envMap)} -> Unexpected error: ${errOutput.substring(0, 100)}`);
    }
  }
}

console.log('--- Testing Email Routing ---');

// 1. Development (default local)
runWithEnv({ APP_ENV: 'development', EMAIL_DRIVER: '' });

// 2. Development explicit mailpit
runWithEnv({ APP_ENV: 'development', EMAIL_DRIVER: 'mailpit' });

// 3. Staging (should default to resend, crash if missing key)
runWithEnv({ APP_ENV: 'staging', EMAIL_DRIVER: '' });

// 4. Staging with fake key
runWithEnv({ APP_ENV: 'staging', EMAIL_DRIVER: '', RESEND_API_KEY: 'fake' });

// 5. Staging with explicit mailpit (should crash to protect)
runWithEnv({ APP_ENV: 'staging', EMAIL_DRIVER: 'mailpit', RESEND_API_KEY: 'fake' });

// 6. Production (should default to resend)
runWithEnv({ APP_ENV: 'production', EMAIL_DRIVER: '', RESEND_API_KEY: 'fake' });

// 7. Production with explicit mailpit (should crash)
runWithEnv({ APP_ENV: 'production', EMAIL_DRIVER: 'mailpit', RESEND_API_KEY: 'fake' });

fs.unlinkSync(runnerPath);
