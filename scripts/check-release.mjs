// `prepublishOnly` guard: refuse `npm publish` unless the working tree is clean
// and HEAD is exactly the tag v<package.json version>.
//
// npm publishes whatever is in the directory you run it from — not what a tag
// points at. Publishing from a feature branch (or with uncommitted edits) would
// ship code under a version number whose tag, changelog and tests say
// otherwise. publish.yml has its own tag check, so this is skipped in Actions.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

if (process.env.GITHUB_ACTIONS === 'true') process.exit(0);

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const refuse = (why) => {
  console.error(`\n  ✖ npm publish refused: ${why}\n`);
  process.exit(1);
};

let dirty, tags, branch;
try {
  dirty = git('status', '--porcelain');
  tags = git('tag', '--points-at', 'HEAD').split('\n').filter(Boolean);
  branch = git('rev-parse', '--abbrev-ref', 'HEAD');
} catch {
  console.warn('  (not a git checkout — skipping the release check)');
  process.exit(0);
}

if (dirty) refuse('the working tree has uncommitted changes. Commit or stash them first.');
if (!tags.includes(`v${version}`)) {
  refuse(
    `HEAD (${branch}) is not tagged v${version}` +
      (tags.length ? ` — it is tagged ${tags.join(', ')}` : '') +
      `. Check out the release tag, or bump the version and tag that commit.`
  );
}
console.log(`  ✓ release check: clean tree, HEAD is v${version}`);
