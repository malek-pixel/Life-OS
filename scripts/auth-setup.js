/**
 * `npm run auth:setup` - creates the two server secrets for a deployment.
 *
 * Prompts for the owner password without echoing it, and prints:
 *   LIFEOS_PASSWORD_HASH   PBKDF2-SHA256 hash of the password (never the password)
 *   LIFEOS_SESSION_SECRET  48 random bytes for signing session cookies
 *
 * Paste both into the hosting provider's environment variables. Nothing is
 * written to disk, and the password itself is never printed or stored.
 */

import { createInterface } from 'node:readline';
import { hashPassword } from '../server/auth.js';

const MIN_LENGTH = 12;

// `npm run auth:setup -- --show` shows the password as it is typed, for anyone
// who finds typing into a blank prompt confusing. Only do this with nobody
// watching the screen.
const SHOW = process.argv.includes('--show');

function ask(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (!SHOW) {
      // Mute keystroke echo while the password is typed.
      const write = rl._writeToOutput?.bind(rl);
      rl._writeToOutput = (text) => {
        if (text.includes(question)) write?.(text);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

const password = await ask(SHOW ? 'Choose your Life OS password: ' : 'Owner password (not shown): ');
if (password.length < MIN_LENGTH) {
  console.error(`\nUse at least ${MIN_LENGTH} characters. A long passphrase of random words is best -`);
  console.error('this is the only thing standing between the internet and your app.');
  process.exit(1);
}
const confirm = await ask('Type it again: ');
if (confirm !== password) {
  console.error('\nThe two entries did not match. Nothing was generated.');
  process.exit(1);
}

const hash = await hashPassword(password);
const secret = Buffer.from(crypto.getRandomValues(new Uint8Array(48))).toString('base64url');

console.log('\nAdd these to your deployment environment (Production), then redeploy:\n');
console.log(`LIFEOS_PASSWORD_HASH=${hash}`);
console.log(`LIFEOS_SESSION_SECRET=${secret}`);
console.log('\nKeep them out of git. Changing either one signs out every device.');
