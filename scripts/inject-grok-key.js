// Runs before `ng build` (see package.json's "build" script) - writes the
// real GROK_API_KEY env var (set in Vercel's project settings, never in
// git) into environment.prod.ts's grokApiKey field right before the
// production build compiles it into the bundle. GitHub's own push
// protection already refused a commit with a real key inline in that file,
// so this is how the real key gets into the deployed app without ever
// entering git history.
//
// Safe to run with no key set (local dev, a PR preview without the secret
// configured) - it just leaves grokApiKey as '' and logs a warning, same
// as if this script didn't run at all. It never fails the build over a
// missing key, since the app already handles an empty grokApiKey
// gracefully (GrokService.configured is false, the AI summary card says
// so instead of erroring).

const fs = require('fs');
const path = require('path');

const key = process.env.GROK_API_KEY;
const envProdPath = path.join(__dirname, '..', 'src', 'environments', 'environment.prod.ts');

if (!key) {
  console.warn('[inject-grok-key] GROK_API_KEY not set - building with AI summary disabled.');
  process.exit(0);
}

const escaped = key.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const source = fs.readFileSync(envProdPath, 'utf8');
const updated = source.replace(/grokApiKey:\s*'[^']*'/, `grokApiKey: '${escaped}'`);

if (updated === source) {
  console.warn('[inject-grok-key] Could not find grokApiKey field in environment.prod.ts - nothing replaced.');
  process.exit(0);
}

fs.writeFileSync(envProdPath, updated);
console.log('[inject-grok-key] GROK_API_KEY injected into environment.prod.ts for this build.');
