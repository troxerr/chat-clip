const assert = require('node:assert/strict');
const { test } = require('node:test');

function release(version, overrides = {}) {
  return {
    tag_name: `win-v${version}`,
    assets: ['', '-portable'].map((suffix) => ({
      name: `ClipSpike-${version}-x64${suffix}.exe`,
      state: 'uploaded',
    })),
    ...overrides,
  };
}

test('selects the newest stable Windows release with both downloads uploaded', async () => {
  const { windowsReleaseVersion } = await import('../tools/update-windows-download.mjs');
  assert.equal(windowsReleaseVersion([
    release('0.1.20', { draft: true }),
    release('0.1.19', { prerelease: true }),
    release('0.1.18', { assets: release('0.1.18').assets.slice(0, 1) }),
    release('0.1.17', { tag_name: 'v0.1.17' }),
    release('0.1.9'),
    release('0.1.10'),
  ]), '0.1.10');
  assert.equal(windowsReleaseVersion([]), undefined);
});
