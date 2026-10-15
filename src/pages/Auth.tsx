import { useEffect, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { PROJECT_KEY_RE } from '../../shared/constants';
import { api } from '../lib/api';
import { lang, setLang, t } from '../lib/i18n';
import { navigate } from '../lib/router';
import { errorMessage } from '../store/actions';
import { suggestKey } from '../components/Dialogs';
import { afterSignIn } from '../app';

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" class="logo">
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <path d="M9 16.5l4.5 4.5L23 11.5" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ComponentChildren; footer?: ComponentChildren }) {
  return (
    <div class="auth">
      <div class="auth-card">
        <div class="auth-brand">
          <Logo />
          <span>Tackle</span>
        </div>
        <h1>{title}</h1>
        {subtitle && <p class="muted">{subtitle}</p>}
        {children}
      </div>
      <div class="auth-footer">
        {footer}
        <button class="link-btn" onClick={() => setLang(lang.value === 'ru' ? 'en' : 'ru')}>
          {lang.value === 'ru' ? 'English' : 'Русский'}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children, hint }: { label: string; children: ComponentChildren; hint?: ComponentChildren }) {
  return (
    <label class="field">
      <span>{label}</span>
      {children}
      {hint && <small class="muted">{hint}</small>}
    </label>
  );
}

function useForm() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return { error, busy, run };
}

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { error, busy, run } = useForm();
  return (
    <AuthLayout title={t('auth.welcome')} subtitle={t('auth.loginSubtitle')}>
      <form
        class="form"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await api.post('/login', { email, password });
            await afterSignIn();
          });
        }}
      >
        <Field label={t('auth.email')}>
          <input class="input" type="email" autocomplete="email" required autoFocus value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} />
        </Field>
        <Field label={t('auth.password')}>
          <input class="input" type="password" autocomplete="current-password" required value={password} onInput={(e) => setPassword((e.target as HTMLInputElement).value)} />
        </Field>
        {error && <div class="form-error">{error}</div>}
        <button class="btn primary lg" disabled={busy}>
          {t('auth.login')}
        </button>
        <p class="muted small center">{t('auth.forgot')}</p>
      </form>
    </AuthLayout>
  );
}

export function Setup() {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({ workspaceName: '', name: '', email: '', password: '', projectName: '', projectKey: '' });
  const [keyTouched, setKeyTouched] = useState(false);
  const { error, busy, run } = useForm();
  const set = (k: keyof typeof form) => (e: Event) => setForm({ ...form, [k]: (e.target as HTMLInputElement).value });
  const key = keyTouched ? form.projectKey : suggestKey(form.projectName);

  return (
    <AuthLayout title={step === 1 ? t('setup.title') : t('setup.projectTitle')} subtitle={step === 1 ? t('setup.subtitle') : t('setup.projectSubtitle')}>
      <div class="steps">
        <span class={step >= 1 ? 'on' : ''} />
        <span class={step >= 2 ? 'on' : ''} />
      </div>
      {step === 1 ? (
        <form
          class="form"
          onSubmit={(e) => {
            e.preventDefault();
            setStep(2);
          }}
        >
          <Field label={t('setup.workspace')}>
            <input class="input" required autoFocus placeholder="Acme Inc." value={form.workspaceName} onInput={set('workspaceName')} />
          </Field>
          <Field label={t('auth.name')}>
            <input class="input" required autocomplete="name" value={form.name} onInput={set('name')} />
          </Field>
          <Field label={t('auth.email')}>
            <input class="input" type="email" required autocomplete="email" value={form.email} onInput={set('email')} />
          </Field>
          <Field label={t('auth.password')} hint={t('auth.passwordHint')}>
            <input class="input" type="password" required minLength={8} autocomplete="new-password" value={form.password} onInput={set('password')} />
          </Field>
          <button class="btn primary lg">{t('common.continue')}</button>
        </form>
      ) : (
        <form
          class="form"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await api.post('/setup', { ...form, projectKey: key, locale: lang.value });
              await afterSignIn();
            });
          }}
        >
          <Field label={t('project.name')}>
            <input class="input" required autoFocus placeholder={t('project.namePlaceholder')} value={form.projectName} onInput={set('projectName')} />
          </Field>
          <Field label={t('project.key')} hint={t('project.keyHint', { example: `${key || 'KEY'}-1` })}>
            <input
              class="input mono"
              required
              maxLength={6}
              value={key}
              onInput={(e) => {
                setKeyTouched(true);
                setForm({ ...form, projectKey: (e.target as HTMLInputElement).value.toUpperCase().replace(/[^A-Z0-9]/g, '') });
              }}
            />
          </Field>
          {error && <div class="form-error">{error}</div>}
          <div class="form-row">
            <button type="button" class="btn lg" onClick={() => setStep(1)}>
              {t('common.back')}
            </button>
            <button class="btn primary lg grow" disabled={busy || !PROJECT_KEY_RE.test(key)}>
              {t('setup.finish')}
            </button>
          </div>
        </form>
      )}
    </AuthLayout>
  );
}

export function Join({ token }: { token: string }) {
  const [info, setInfo] = useState<{ workspace: { name: string } } | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const { error, busy, run } = useForm();
  useEffect(() => {
    api.get<{ workspace: { name: string } }>(`/invites/${token}`).then(setInfo, () => setInvalid(true));
  }, [token]);
  const set = (k: keyof typeof form) => (e: Event) => setForm({ ...form, [k]: (e.target as HTMLInputElement).value });

  if (invalid) {
    return (
      <AuthLayout title={t('join.invalid')} subtitle={t('join.invalidText')}>
        <button class="btn primary lg" onClick={() => navigate('/login')}>
          {t('auth.login')}
        </button>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title={info ? t('join.title', { name: info.workspace.name }) : '…'} subtitle={t('join.subtitle')}>
      <form
        class="form"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await api.post('/join', { token, ...form });
            await afterSignIn();
          });
        }}
      >
        <Field label={t('auth.name')}>
          <input class="input" required autoFocus autocomplete="name" value={form.name} onInput={set('name')} />
        </Field>
        <Field label={t('auth.email')}>
          <input class="input" type="email" required autocomplete="email" value={form.email} onInput={set('email')} />
        </Field>
        <Field label={t('auth.password')} hint={t('auth.passwordHint')}>
          <input class="input" type="password" required minLength={8} autocomplete="new-password" value={form.password} onInput={set('password')} />
        </Field>
        {error && <div class="form-error">{error}</div>}
        <button class="btn primary lg" disabled={busy || !info}>
          {t('join.submit')}
        </button>
      </form>
    </AuthLayout>
  );
}

export function Reset({ token }: { token: string }) {
  const [info, setInfo] = useState<{ name?: string; email?: string } | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [password, setPassword] = useState('');
  const { error, busy, run } = useForm();
  useEffect(() => {
    api.get<{ name?: string; email?: string }>(`/reset/${token}`).then(setInfo, () => setInvalid(true));
  }, [token]);
  if (invalid) {
    return (
      <AuthLayout title={t('join.invalid')} subtitle={t('join.invalidText')}>
        <button class="btn primary lg" onClick={() => navigate('/login')}>
          {t('auth.login')}
        </button>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title={t('reset.title')} subtitle={info?.email ? t('reset.subtitle', { email: info.email }) : undefined}>
      <form
        class="form"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await api.post('/reset', { token, password });
            await afterSignIn();
          });
        }}
      >
        <Field label={t('settings.newPassword')} hint={t('auth.passwordHint')}>
          <input class="input" type="password" required minLength={8} autoFocus autocomplete="new-password" value={password} onInput={(e) => setPassword((e.target as HTMLInputElement).value)} />
        </Field>
        {error && <div class="form-error">{error}</div>}
        <button class="btn primary lg" disabled={busy || !info}>
          {t('reset.submit')}
        </button>
      </form>
    </AuthLayout>
  );
}
