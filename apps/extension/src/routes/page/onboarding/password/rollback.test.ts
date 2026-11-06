import { localExtStorage } from '@repo/storage-chrome/local';
import { sessionExtStorage } from '@repo/storage-chrome/session';
import { beforeEach, describe, expect, test } from 'vitest';
import { create } from 'zustand';
import { AllSlices, initializeStore } from '../../../../state';
import {
  markHydrated,
  readEncrypted,
  writeEncryptedDirect,
} from '../../../../state/encrypted-storage';
import { restoreSnapshot } from './hooks';
import { createMasterKey, recreateMasterKey } from '../../../../state/keyring/crypto-ops';
import type { EncryptedVault } from '../../../../state/keyring/types';

const localMock = (chrome.storage.local as unknown as { mock: Map<string, unknown> }).mock;
const sessionMock = (chrome.storage.session as unknown as { mock: Map<string, unknown> }).mock;
type LK = Parameters<typeof readEncrypted>[2];

// a failed import must put the keyprint back with the data it sealed
describe('onboarding rollback', () => {
  beforeEach(() => {
    localMock.clear();
    sessionMock.clear();
    markHydrated();
  });

  test('a first password on an airgap-only profile is undone, other writes kept', async () => {
    const store = create<AllSlices>()(initializeStore(sessionExtStorage, localExtStorage));
    const kr = () => store.getState().keyRing;
    // a profile from before passwords were required: its first zigner import
    // made the key from ''
    const blank = await createMasterKey('');
    await sessionExtStorage.set('passwordKey', blank.keyJson);
    await localExtStorage.set('passwordKeyPrint', blank.keyPrint.toJson());
    const id = await kr().addZignerUnencrypted(
      { viewingKey: 'em9yY2hhcmQtZnZr', accountIndex: 0, deviceId: 'dev' },
      'zigner',
    );
    localMock.set(
      'vaults',
      ((localMock.get('vaults') ?? []) as EncryptedVault[]).map(v => ({
        ...v,
        insensitive: { ...v.insensitive, airgapOnly: true },
      })),
    );
    await writeEncryptedDirect(localExtStorage, sessionExtStorage, 'contacts' as LK, [{ id: 'a' }]);
    const snapshot = await chrome.storage.local.get(null);
    const { passwordKey } = await chrome.storage.session.get('passwordKey');

    await kr().setPassword('the first real password'); // moves every store
    // another context writes meanwhile; the undo must leave that standing
    await writeEncryptedDirect(localExtStorage, sessionExtStorage, 'contacts' as LK, [
      { id: 'a' },
      { id: 'b' },
    ]);
    await kr().newMnemonicKey(
      'advance twist canal impact field normal depend pink sick horn world broccoli',
      'hot',
    );
    await restoreSnapshot(snapshot, passwordKey); // and then the import failed

    const fresh = create<AllSlices>()(initializeStore(sessionExtStorage, localExtStorage));
    sessionMock.clear();
    expect(await fresh.getState().keyRing.unlock('the first real password')).toBe(false);
    // back to a profile that still has to set its first password
    expect(await fresh.getState().keyRing.needsPassword()).toBe(true);
    // and its data still opens with the key it had
    const blankKey = await recreateMasterKey('', (await localExtStorage.get('passwordKeyPrint'))!);
    await sessionExtStorage.set('passwordKey', blankKey!.keyJson);
    expect(((await localExtStorage.get('vaults')) ?? []).map(v => v.id)).toEqual([id]);
    expect(await readEncrypted(localExtStorage, sessionExtStorage, 'contacts' as LK)).toEqual([
      { id: 'a' },
      { id: 'b' },
    ]);
  });

  test('an import on a profile with a password puts back only what it wrote', async () => {
    const store = create<AllSlices>()(initializeStore(sessionExtStorage, localExtStorage));
    await store.getState().keyRing.setPassword('pw pw pw pw');
    const id = await store
      .getState()
      .keyRing.newMnemonicKey(
        'advance twist canal impact field normal depend pink sick horn world broccoli',
        'hot',
      );
    const snapshot = await chrome.storage.local.get(null);
    const { passwordKey } = await chrome.storage.session.get('passwordKey');
    await store
      .getState()
      .keyRing.addZignerUnencrypted(
        { viewingKey: 'em9yY2hhcmQtZnZr', accountIndex: 0, deviceId: 'dev' },
        'zigner',
      );
    await restoreSnapshot(snapshot, passwordKey);
    expect(((await localExtStorage.get('vaults')) ?? []).map(v => v.id)).toEqual([id]);
    expect(await store.getState().keyRing.getMnemonic(id)).toMatch(/^advance/);
  });
});
