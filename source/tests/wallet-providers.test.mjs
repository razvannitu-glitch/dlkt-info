import test from 'node:test';
import assert from 'node:assert/strict';
import {getWalletProviders, isWalletProviderId} from '../.build/src/wallet/providers.js';

test('provider catalog is immutable and cannot pretend a connection is provisioned', () => {
  const providers = getWalletProviders();
  assert.deepEqual(providers.map(provider => provider.id), ['gmail', 'outlook', 'instagram', 'facebook-pages']);
  for (const provider of providers) {
    assert.equal(provider.status, 'unavailable');
    assert.equal(provider.connectionAvailable, false);
    assert(Object.isFrozen(provider));
    assert(Object.isFrozen(provider.capabilities));
    assert(Object.isFrozen(provider.limitations));
    assert.throws(() => { provider.connectionAvailable = true; }, TypeError);
  }
  assert(Object.isFrozen(providers));
  assert.equal(getWalletProviders({WALLET_CONNECTIONS_ENABLED: true})[0].connectionAvailable, false);
});

test('catalog explains eligible accounts and does not promise universal viewers or inbox access', () => {
  const [gmail, outlook, instagram, facebook] = getWalletProviders();
  assert.match(gmail.limitations.join(' '), /metadata only.*does not read message bodies/u);
  assert.match(outlook.accountType, /Personal Microsoft.*work/u);
  assert.match(instagram.accountType, /Business or Creator/u);
  assert.match(instagram.limitations.join(' '), /personal Instagram accounts are not eligible/u);
  assert.match(instagram.limitations.join(' '), /does not retrieve direct messages, mentions, insights or identities of viewers and sharers/u);
  assert.match(facebook.limitations.join(' '), /does not provide your personal Facebook inbox/u);
  assert.match(facebook.limitations.join(' '), /does not retrieve conversations, insights or identities of viewers and sharers/u);
  assert.equal(isWalletProviderId('gmail'), true);
  for (const value of ['x', 'Gmail', '__proto__', {}, null]) assert.equal(isWalletProviderId(value), false);
});
