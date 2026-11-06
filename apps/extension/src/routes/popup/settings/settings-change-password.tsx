/** change password (SetPassword.dc.html) - re-seals every secret, all or nothing */

import { FormEvent, useState } from 'react';
import { Button } from '@repo/ui/components/ui/button';
import { Input } from '@repo/ui/components/ui/input';
import { cn } from '@repo/ui/lib/utils';
import { ScreenHeader } from '../../../components/screen-header';
import { useStore } from '../../../state';
import { useBackNav } from '../../../utils/navigate';
import { PopupPath } from '../paths';

type Outcome = 'wrong' | 'same' | 'broke' | 'done';

const NOTE: Record<Outcome | 'mismatch', [string, string]> = {
  wrong: ["that doesn't match · please try again", 'text-warning'],
  mismatch: ["these don't match yet", 'text-warning'],
  same: ['that is the password already · please choose a new one', 'text-warning'],
  broke: ['something broke on our side, not yours. nothing was changed.', 'text-warning'],
  done: ['your new password is set', 'text-green'],
};

const FIELDS = [
  ['current', 'current password', 'current-password'],
  ['next', 'new password', 'new-password'],
  ['again', 'confirm new password', 'new-password'],
] as const;

export const SettingsChangePassword = () => {
  const changePassword = useStore(s => s.keyRing.changePassword);
  const back = useBackNav(PopupPath.SETTINGS_SECURITY);
  const [form, setForm] = useState({ current: '', next: '', again: '' });
  const [outcome, setOutcome] = useState<Outcome>();
  const [busy, setBusy] = useState(false);

  const mismatch =
    form.again.length >= form.next.length && !!form.again && form.again !== form.next;
  const note = outcome ? NOTE[outcome] : mismatch ? NOTE.mismatch : undefined;

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (outcome === 'done') {
      back();
      return;
    }
    // read at submit, not from react state: autofill can fill a field without
    // the change event that state waits on
    const data = new FormData(e.currentTarget);
    const [current, next, again] = FIELDS.map(([name]) => String(data.get(name) ?? ''));
    setForm({ current: current!, next: next!, again: again! });
    if (!current || !next || next !== again || busy) {
      return;
    }
    if (next === current) {
      setOutcome('same');
      return;
    }
    setBusy(true);
    void changePassword(current, next)
      .then(ok => setOutcome(ok ? 'done' : 'wrong'))
      .catch(() => setOutcome('broke'))
      .finally(() => setBusy(false));
  };

  return (
    <form onSubmit={submit} className='flex min-h-full flex-col'>
      <ScreenHeader title='change password' backPath={PopupPath.SETTINGS_SECURITY} />
      <div className='flex grow flex-col gap-3.5 px-4 pt-[18px]'>
        <p className='text-xs/[1.6] text-fg-muted'>
          this only protects this wallet on this computer. it never touches your zec or your
          recovery phrase.
        </p>
        {FIELDS.map(([name, label, autoComplete], i) => (
          <div key={name} className='contents'>
            <label htmlFor={`pw-${name}`} className='text-[11px] text-fg-muted'>
              {label}
            </label>
            <Input
              id={`pw-${name}`}
              name={name}
              type='password'
              autoFocus={i === 0}
              autoComplete={autoComplete}
              disabled={outcome === 'done'}
              variant={
                (name === 'current' && outcome === 'wrong') ||
                (name === 'next' && outcome === 'same') ||
                (name === 'again' && mismatch)
                  ? 'warn'
                  : 'default'
              }
              value={form[name]}
              onChange={e => {
                setForm(f => ({ ...f, [name]: e.target.value }));
                setOutcome(undefined);
              }}
              className='px-3.5 text-[15px]'
            />
          </div>
        ))}
        <span className={cn('h-[18px] text-label', note?.[1])} aria-live='polite'>
          {note?.[0]}
        </span>
      </div>
      <div className='border-t border-border-soft px-4 pb-4 pt-3'>
        <Button type='submit' loading={busy} className='w-full'>
          {outcome === 'done' ? 'done' : 'change password'}
        </Button>
      </div>
    </form>
  );
};
