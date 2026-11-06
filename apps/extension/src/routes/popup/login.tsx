import { Button } from '@repo/ui/components/ui/button';
import { Input } from '@repo/ui/components/ui/input';
import { Mark } from '@repo/ui/components/ui/mark';
import { cn } from '@repo/ui/lib/utils';
import { usePopupNav } from '../../utils/navigate';
import { useStore } from '../../state';
import { getIdentityKey } from '../../state/identity-keys';
import { selectEffectiveKeyInfo, selectGetMnemonic } from '../../state/keyring';
import { FormEvent, useEffect, useState } from 'react';
import { PopupPath } from './paths';
import { needsOnboard, safeNext } from './popup-needs';
import { useLocation, useNavigate } from 'react-router-dom';

export const popupLoginLoader = () => needsOnboard();

/**
 * The first password of an airgap-only profile made before every profile had
 * one. Setting it moves every sealed record to it (keyRing.setPassword); from
 * then on this profile unlocks with it, like any other.
 */
const FirstPassword = ({ onDone }: { onDone: () => void }) => {
  const setPassword = useStore(s => s.keyRing.setPassword);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const password = String(form.get('password') ?? '');
    if (!password) {
      setNote('please choose a password');
      return;
    }
    if (password !== String(form.get('again') ?? '')) {
      setNote("these don't match yet");
      return;
    }
    setBusy(true);
    void setPassword(password)
      .then(onDone)
      .catch(() => setNote('something broke on our side, not yours. nothing was changed.'))
      .finally(() => setBusy(false));
  };

  return (
    <form onSubmit={submit} className='flex flex-col gap-[18px]'>
      <p className='text-body text-fg-muted'>
        zafu now asks for a password before it opens. set one to keep your balances, history and
        contacts to yourself.
      </p>
      <label htmlFor='first-password' className='sr-only'>
        password
      </label>
      <Input
        id='first-password'
        name='password'
        type='password'
        autoFocus
        autoComplete='new-password'
        placeholder='password'
        onChange={() => setNote('')}
        className='h-[52px] px-3.5 text-[15px]'
      />
      <label htmlFor='first-password-again' className='sr-only'>
        again
      </label>
      <Input
        id='first-password-again'
        name='again'
        type='password'
        autoComplete='new-password'
        placeholder='again'
        onChange={() => setNote('')}
        className='h-[52px] px-3.5 text-[15px]'
      />
      <span className='h-[18px] text-label text-warning' aria-live='polite'>
        {note}
      </span>
      <Button type='submit' loading={busy} className='h-[52px] text-[15px]'>
        set a password
      </Button>
    </form>
  );
};

export const Login = () => {
  const navigate = usePopupNav();
  const routerNavigate = useNavigate();
  const location = useLocation();

  const unlock = useStore(s => s.keyRing.unlock);
  const needsPassword = useStore(s => s.keyRing.needsPassword);
  const activeKeyInfo = useStore(selectEffectiveKeyInfo);
  const getMnemonic = useStore(selectGetMnemonic);
  const [enteredIncorrect, setEnteredIncorrect] = useState(false);
  // an airgap-only profile from before every profile had a password: it sets
  // one here first, and nothing in the wallet opens until it has
  const [firstPassword, setFirstPassword] = useState(false);
  useEffect(() => {
    void needsPassword().then(setFirstPassword);
  }, [needsPassword]);
  // Set when the password is correct (unlock succeeds) but the active wallet's
  // seed is sealed under a stale password key and cannot be decrypted. The
  // wallet is not lost - the user re-imports its recovery phrase. We never
  // mutate or delete anything here.
  const [undecryptable, setUndecryptable] = useState(false);
  // key derivation (PBKDF2, 210k rounds) takes a visible beat on slow machines
  const [unlocking, setUnlocking] = useState(false);

  // back to the screen that sent us here (lockedScreenGuard), if any
  const leave = () => {
    const next = safeNext(new URLSearchParams(location.search).get('next'));
    if (next) {
      routerNavigate(next, { replace: true });
    } else {
      navigate(PopupPath.INDEX);
    }
  };

  const handleUnlock = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (unlocking) {
      return;
    }
    // read at submit, not from react state: a password manager's autofill
    // can fill the field without the change event that state waits on
    const password = String(new FormData(e.currentTarget).get('password') ?? '');
    setUnlocking(true);

    void (async function () {
      try {
        if (await unlock(password)) {
          // Probe the active vault before navigating: the global password is
          // right, but this vault's seed may be sealed under a stale key (e.g.
          // created before a password change) and throw 'failed to decrypt
          // vault'. Surface that gracefully instead of leaving the home screen
          // to spew console errors. Other wallets may be fine, so we don't hard
          // block - we offer re-import or continue.
          if (activeKeyInfo?.type === 'mnemonic') {
            try {
              // the one decrypt passkeys and passwords need this unlock
              await getIdentityKey(activeKeyInfo.id, getMnemonic);
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              if (msg.includes('failed to decrypt vault')) {
                setUndecryptable(true);
                return;
              }
              // any other derivation failure is not an unlock problem - proceed
            }
          }
          leave();
        } else {
          setEnteredIncorrect(true);
        }
      } finally {
        setUnlocking(false);
      }
    })();
  };

  return (
    <div className='relative isolate flex h-full min-h-[628px] flex-col justify-center gap-[18px] bg-canvas px-7'>
      <img
        src='/media/emblem.webp'
        alt=''
        aria-hidden='true'
        className='pointer-events-none absolute left-1/2 top-10 -z-10 size-[260px] -translate-x-1/2 opacity-10'
      />
      <Mark variant='seal' size={54} className='self-center' />
      <h1 className='self-center font-display text-[26px] text-fg-high'>welcome back</h1>
      <span className='self-center text-[11px] tracking-[0.1em] text-fg-muted'>
        shielded signing
      </span>
      {firstPassword ? (
        <FirstPassword onDone={leave} />
      ) : undecryptable ? (
        <>
          <p className='text-body text-fg-muted'>
            this wallet&apos;s recovery data no longer opens with this password. your funds are safe
            - restoring its recovery phrase brings it back.
          </p>
          <Button onClick={() => navigate(PopupPath.SETTINGS_WALLETS)}>restore this wallet</Button>
          <Button variant='quiet' onClick={() => navigate(PopupPath.INDEX)}>
            continue for now
          </Button>
        </>
      ) : (
        <form onSubmit={handleUnlock} className='flex flex-col gap-[18px]'>
          <label htmlFor='unlock-password' className='sr-only'>
            password
          </label>
          <Input
            id='unlock-password'
            name='password'
            type='password'
            autoFocus
            autoComplete='current-password'
            variant={enteredIncorrect ? 'warn' : 'default'}
            onChange={() => setEnteredIncorrect(false)}
            className={cn(
              'h-[52px] px-3.5 text-[15px]',
              enteredIncorrect && 'focus-visible:border-warn',
            )}
          />
          <span className='h-[18px] text-label text-warning' aria-live='polite'>
            {enteredIncorrect ? "that doesn't match · please try again" : ''}
          </span>
          <Button type='submit' loading={unlocking} className='h-[52px] text-[15px]'>
            unlock
          </Button>
          <button
            type='button'
            onClick={() => navigate(PopupPath.FORGOT_PASSWORD)}
            className='self-center bg-transparent text-label text-fg-muted transition-colors hover:text-fg-high'
          >
            forgot it? restore with your recovery phrase
          </button>
        </form>
      )}
    </div>
  );
};
