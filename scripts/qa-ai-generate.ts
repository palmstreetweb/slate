/**
 * Live golden sweep for Build with AI.
 * Usage: npm run qa:ai
 * Requires ANTHROPIC_API_KEY in the environment or .env.local.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runGenerateForm } from '../api/runGenerate.js';
import { mapGeneratedForm } from '../api/mapGeneratedForm.js';
import { checkSchema } from '../src/logic/schemaCheck.js';
import { AI_GOLDEN_PROMPTS } from '../examples/_admin/ai/goldenPrompts.js';

function loadDotEnvLocal(): void {
  if (process.env.ANTHROPIC_API_KEY) return;
  try {
    const raw = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = /^\s*ANTHROPIC_API_KEY\s*=\s*(.*)$/.exec(line);
      if (!m) continue;
      let v = m[1]!.trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      process.env.ANTHROPIC_API_KEY = v;
      return;
    }
  } catch {
    // no local file
  }
}

loadDotEnvLocal();

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY is missing. Add it to .env.local or the environment.');
  process.exit(1);
}

let failed = 0;
for (const item of AI_GOLDEN_PROMPTS) {
  process.stdout.write(`${item.id} … `);
  try {
    const draft = await runGenerateForm(item.prompt);
    const { name, schema } = mapGeneratedForm(draft);
    const issues = checkSchema(schema.questions);
    const types = schema.questions.map((q) => q.type);
    const middle = types.filter((t) => t !== 'welcome' && t !== 'thanks');
    if (issues.length > 0) throw new Error(issues.map((i) => i.message).join('; '));
    if (middle.length < 3) throw new Error(`only ${middle.length} questions`);
    console.log(`ok  ${name}  [${middle.join(', ')}]  theme=${schema.theme}`);
  } catch (err) {
    failed += 1;
    const message = err instanceof Error ? err.message : String(err);
    console.log(`FAIL  ${message}`);
    if (
      /api key is invalid|unauthorized|401|too many optional parameters|grammar is too large/i.test(
        message,
      )
    ) {
      console.error('\nStopping — Anthropic rejected the key. Check ANTHROPIC_API_KEY.');
      process.exit(1);
    }
  }
}

if (failed > 0) {
  console.error(`\n${failed} of ${AI_GOLDEN_PROMPTS.length} failed.`);
  process.exit(1);
}
console.log(`\n${AI_GOLDEN_PROMPTS.length} golden prompts produced valid forms.`);
