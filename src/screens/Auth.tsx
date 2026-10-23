import { useState } from 'react';
import { api, useApi, type User } from '../api';

export function AuthScreen({ onSignedIn }: { onSignedIn: (u: User) => void }) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [joinCode, setJoinCode] = useState(() => {
    try {
      return new URLSearchParams(window.location.search).get('join') ?? '';
    } catch {
      return '';
    }
  });
  const [educatorCode, setEducatorCode] = useState('');
  const [showEducator, setShowEducator] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cfg = useApi<{ educatorSignupEnabled: boolean }>('/api/auth/config');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res =
        mode === 'signin'
          ? await api<{ user: User }>('/api/auth/login', { body: { email, password } })
          : await api<{ user: User }>('/api/auth/signup', { body: { name, email, password, joinCode, educatorCode } });
      onSignedIn(res.user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <section className="auth-intro">
        <p className="eyebrow">Cardiac POCUS · verification practice</p>
        <h1>Can you still catch the AI when it is wrong?</h1>
        <p className="lede">
          CORTEX shows you an echo clip and asks for your read first. Then it shows what an AI model thinks, and the AI is
          sometimes wrong on purpose. Your job is to decide whether to trust it.
        </p>
        <ol className="steps">
          <li>
            <strong>Read the clip yourself.</strong> Pick an answer and say how sure you are.
          </li>
          <li>
            <strong>See the AI read.</strong> Keep your answer or change to the AI's.
          </li>
          <li>
            <strong>Get the reference answer.</strong> CORTEX tracks how often you catch AI errors and picks your next case.
          </li>
        </ol>
      </section>

      <form className="auth-card" onSubmit={submit}>
        <div className="seg seg--full" role="tablist" aria-label="Account">
          <button type="button" role="tab" aria-selected={mode === 'signin'} className={`seg-btn${mode === 'signin' ? ' is-on' : ''}`} onClick={() => setMode('signin')}>
            Sign in
          </button>
          <button type="button" role="tab" aria-selected={mode === 'signup'} className={`seg-btn${mode === 'signup' ? ' is-on' : ''}`} onClick={() => setMode('signup')}>
            Create account
          </button>
        </div>

        {mode === 'signup' && (
          <div className="field">
            <label htmlFor="name">Name or pseudonym</label>
            <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} autoComplete="nickname" />
            <span className="field-help">Educators see this name. A pseudonym is fine.</span>
          </div>
        )}
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={mode === 'signup' ? 8 : 1}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          />
          {mode === 'signup' && <span className="field-help">At least 8 characters.</span>}
        </div>
        {mode === 'signup' && (
          <>
            <div className="field">
              <label htmlFor="join">Cohort code (optional)</label>
              <input id="join" className="input input--code" value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} maxLength={12} placeholder="e.g. K7M2QX" />
              <span className="field-help">From your educator. You can also add it later.</span>
            </div>
            {cfg.data?.educatorSignupEnabled &&
              (showEducator ? (
                <div className="field">
                  <label htmlFor="educator">Educator code</label>
                  <input id="educator" className="input" value={educatorCode} onChange={(e) => setEducatorCode(e.target.value)} />
                </div>
              ) : (
                <button type="button" className="linklike" onClick={() => setShowEducator(true)}>
                  I'm an educator
                </button>
              ))}
          </>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn--primary" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
        </button>
      </form>
    </div>
  );
}

export function ConsentScreen({ version, onDone }: { version: string; onDone: () => void }) {
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/api/me/consent', { body: { version } });
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className="page page--narrow">
      <form className="auth-card" onSubmit={submit}>
        <p className="eyebrow">Before you start</p>
        <h1>How this simulation works</h1>
        <ul className="consent-list">
          <li>The AI in this simulation is sometimes wrong on purpose. You will not be told which cases until you answer.</li>
          <li>Every case ends with the reference answer and an explanation, so no wrong AI read is left uncorrected.</li>
          <li>The clips and cases are for training only. They are not clinical guidance.</li>
          <li>Your answers are stored on this service. If you join a cohort, your educator sees your results under your account name.</li>
          <li>Scores are practice observations, never a grade, a credential or a competence decision.</li>
        </ul>
        <label className="check">
          <input id="consent" type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>I understand and want to take part</span>
        </label>
        {error && <p className="form-error">{error}</p>}
        <button type="submit" className="btn btn--primary" disabled={!agree || busy}>
          Start practice
        </button>
        <p className="case-id">Consent version {version}</p>
      </form>
    </div>
  );
}
