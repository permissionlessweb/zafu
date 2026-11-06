import { localExtStorage } from '@repo/storage-chrome/local';
import { sessionExtStorage } from '@repo/storage-chrome/session';
import { beforeEach, describe, expect, test } from 'vitest';
import { create } from 'zustand';
import { AllSlices, initializeStore, TestStore } from '..';
import { createMasterKey, decryptVault, recreateMasterKey } from './crypto-ops';
import { NoPasswordError } from '.';
import type { EncryptedVault } from './types';

const localMock = (chrome.storage.local as unknown as { mock: Map<string, unknown> }).mock;
const sessionMock = (chrome.storage.session as unknown as { mock: Map<string, unknown> }).mock;

const PASSWORD = 'ink and gold road';
const zigner = { viewingKey: 'em9yY2hhcmQtZnZr', accountIndex: 0, deviceId: 'dev' };

const vaults = () => (localMock.get('vaults') ?? []) as EncryptedVault[];

/** what a profile looked like when its first zigner import made the key from '' */
const legacyAirgapOnly = async () => {
  const { keyJson, keyPrint } = await createMasterKey('');
  await sessionExtStorage.set('passwordKey', keyJson);
  await localExtStorage.set('passwordKeyPrint', keyPrint.toJson());
  const store: TestStore = create<AllSlices>()(initializeStore(sessionExtStorage, localExtStorage));
  const id = await store.getState().keyRing.addZignerUnencrypted(zigner, 'zigner');
  localMock.set(
    'vaults',
    vaults().map(v => ({ ...v, insensitive: { ...v.insensitive, airgapOnly: true } })),
  );
  // the browser closed: the session key is gone, only the '' keyprint is left
  sessionMock.clear();
  return id;
};

// Every profile has a real password before any wallet is stored. A profile
// whose only wallets were airgap imports used to be sealed under a key made
// from '' and opened itself, balances, history and contacts, for anyone at the
// computer; and once locked, the password chosen later did not open it.
describe('airgap imports need a password', () => {
  let useStore: TestStore;
  const kr = () => useStore.getState().keyRing;

  beforeEach(() => {
    localMock.clear();
    sessionMock.clear();
    useStore = create<AllSlices>()(initializeStore(sessionExtStorage, localExtStorage));
  });

  test('a first zigner import without a password is refused, and nothing is stored', async () => {
    await expect(kr().addZignerUnencrypted(zigner, 'zigner')).rejects.toThrow(NoPasswordError);
    expect(localMock.get('passwordKeyPrint')).toBeUndefined();
    expect(localMock.get('vaults')).toBeUndefined();
    expect(sessionMock.get('passwordKey')).toBeUndefined();
  });

  test('a first ledger import without a password is refused, and nothing is stored', async () => {
    await expect(
      kr().addLedgerUnencrypted(
        { address: 't1abc', transparentAddress: 't1abc', accountIndex: 0, deviceId: 'l' },
        'ledger',
      ),
    ).rejects.toThrow(NoPasswordError);
    expect(localMock.get('passwordKeyPrint')).toBeUndefined();
    expect(localMock.get('vaults')).toBeUndefined();
  });

  test('no key is ever made from an empty password', async () => {
    await expect(kr().setPassword('')).rejects.toThrow();
    expect(localMock.get('passwordKeyPrint')).toBeUndefined();

    await kr().setPassword(PASSWORD);
    await kr().addZignerUnencrypted(zigner, 'zigner');
    const print = await localExtStorage.get('passwordKeyPrint');
    expect(await recreateMasterKey('', print!)).toBeNull();
    expect(vaults()[0]!.insensitive['airgapOnly']).toBeUndefined();
    expect(await kr().needsPassword()).toBe(false);
  });

  test('a zigner-only profile locks and unlocks with its password in the same session', async () => {
    await kr().setPassword(PASSWORD);
    await kr().addZignerUnencrypted(zigner, 'zigner');

    kr().lock();
    expect(kr().status).toBe('locked');
    await kr().init();
    // nothing opens it on its own
    expect(kr().status).toBe('locked');
    expect(await sessionExtStorage.get('passwordKey')).toBeUndefined();

    expect(await kr().unlock('')).toBe(false);
    expect(await kr().unlock('not it')).toBe(false);
    expect(await kr().unlock(PASSWORD)).toBe(true);
    expect(
      JSON.parse(await decryptVault({ session: sessionExtStorage }, vaults()[0]!)),
    ).toMatchObject({ deviceId: 'dev' });
  });
});

describe('an airgap-only profile from before passwords were required', () => {
  beforeEach(() => {
    localMock.clear();
    sessionMock.clear();
  });

  test('stays locked, sets a password, and then opens only with it', async () => {
    const id = await legacyAirgapOnly();
    const useStore: TestStore = create<AllSlices>()(
      initializeStore(sessionExtStorage, localExtStorage),
    );
    const kr = () => useStore.getState().keyRing;
    const vault = () => vaults().find(v => v.id === id)!;

    await kr().init();
    expect(kr().status).toBe('locked');
    expect(await sessionExtStorage.get('passwordKey')).toBeUndefined();
    expect(await kr().needsPassword()).toBe(true);
    expect(await kr().unlock('')).toBe(false);

    await kr().setPassword(PASSWORD);
    expect(kr().status).toBe('unlocked');
    expect(vault().insensitive['airgapOnly']).toBeUndefined();
    expect(await kr().needsPassword()).toBe(false);

    kr().lock();
    await kr().init();
    expect(kr().status).toBe('locked');
    expect(await kr().unlock('')).toBe(false);
    expect(await kr().unlock(PASSWORD)).toBe(true);
    expect(JSON.parse(await decryptVault({ session: sessionExtStorage }, vault()))).toMatchObject({
      deviceId: 'dev',
    });
  });
});

describe('keyRing.changePassword', () => {
  test('a wrong current password, or an empty new one, changes nothing', async () => {
    localMock.clear();
    sessionMock.clear();
    const useStore: TestStore = create<AllSlices>()(
      initializeStore(sessionExtStorage, localExtStorage),
    );
    const kr = () => useStore.getState().keyRing;
    await kr().setPassword(PASSWORD);
    await kr().addZignerUnencrypted(zigner, 'zigner');
    const before = Object.fromEntries(localMock);

    expect(await kr().changePassword('not it', 'a new password')).toBe(false);
    expect(await kr().changePassword(PASSWORD, '')).toBe(false);
    expect(Object.fromEntries(localMock)).toEqual(before);

    kr().lock();
    expect(await kr().unlock('a new password')).toBe(false);
    expect(await kr().unlock(PASSWORD)).toBe(true);
  });
});

describe('password.setPassword', () => {
  test('never writes a new keyprint over an existing one', async () => {
    localMock.clear();
    sessionMock.clear();
    const useStore: TestStore = create<AllSlices>()(
      initializeStore(sessionExtStorage, localExtStorage),
    );
    await useStore.getState().keyRing.setPassword(PASSWORD);
    const print = localMock.get('passwordKeyPrint');

    await expect(useStore.getState().password.setPassword('something else')).rejects.toThrow();
    expect(localMock.get('passwordKeyPrint')).toEqual(print);
  });
});
