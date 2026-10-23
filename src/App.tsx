import { useEffect, useRef, useState } from 'react';
import { api, ApiError, type User } from './api';
import { Admin } from './screens/Admin';
import { AuthScreen, ConsentScreen } from './screens/Auth';
import { Cases } from './screens/Cases';
import { Cohorts } from './screens/Cohorts';
import { Practice } from './screens/Practice';
import { Profile } from './screens/Profile';

type View = 'practice' | 'profile' | 'cohorts' | 'cases' | 'admin';

const NAV: { id: View; label: string; roles: User['role'][] }[] = [
  { id: 'practice', label: 'Practice', roles: ['trainee', 'educator', 'admin'] },
  { id: 'profile', label: 'My profile', roles: ['trainee', 'educator', 'admin'] },
  { id: 'cohorts', label: 'Cohorts', roles: ['educator', 'admin'] },
  { id: 'cases', label: 'Case bank', roles: ['educator', 'admin'] },
  { id: 'admin', label: 'Admin', roles: ['admin'] },
];

function readHash(): View {
  const h = window.location.hash.replace('#', '');
  return (NAV.some((n) => n.id === h) ? h : 'practice') as View;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [consentVersion, setConsentVersion] = useState<string>('');
  const [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState<string | null>(null);
  const [view, setView] = useState<View>(readHash);
  const [notice, setNotice] = useState<string | null>(null);

  const loadMe = async () => {
    try {
      const r = await api<{ user: User; consentRequired: string }>('/api/auth/me');
      setUser(r.user);
      setConsentVersion(r.consentRequired);
      setBootError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setUser(null);
        const cfg = await api<{ consentVersion: string }>('/api/auth/config').catch(() => null);
        if (cfg) setConsentVersion(cfg.consentVersion);
        setBootError(null);
      } else setBootError((e as Error).message);
    } finally {
      setBooting(false);
    }
  };

  useEffect(() => {
    void loadMe();
    const on = () => setView(readHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  // Invite links: /?join=CODE joins the cohort once signed in
  useEffect(() => {
    if (!user) return;
    const code = new URLSearchParams(window.location.search).get('join');
    if (!code) return;
    api<{ cohort: { name: string } }>('/api/cohorts/join', { body: { code } })
      .then((r) => setNotice(`You joined ${r.cohort.name}.`))
      .catch((e) => setNotice((e as Error).message))
      .finally(() => window.history.replaceState(null, '', `/${window.location.hash}`));
  }, [user]);

  const go = (v: View) => {
    setView(v);
    window.history.replaceState(null, '', `#${v}`);
    window.scrollTo({ top: 0 });
  };

  const signOut = async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    setUser(null);
    go('practice');
  };

  if (booting) return <div className="boot">Loading CORTEX…</div>;
  if (bootError)
    return (
      <div className="boot">
        <p>{bootError}</p>
        <button type="button" className="btn" onClick={() => void loadMe()}>
          Try again
        </button>
      </div>
    );

  const allowed = user ? NAV.filter((n) => n.roles.includes(user.role)) : [];
  const current = allowed.some((n) => n.id === view) ? view : 'practice';
  const needsConsent = user && user.consentVersion !== consentVersion;

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <button type="button" className="brand" onClick={() => go('practice')}>
            <span className="brand-mark" aria-hidden="true" />
            <span className="brand-name">CORTEX</span>
            <span className="brand-tag">Verification trainer</span>
          </button>
          {user && !needsConsent && (
            <nav className="nav" aria-label="Main">
              {allowed.map((n) => (
                <button key={n.id} type="button" className={`nav-btn${current === n.id ? ' is-on' : ''}`} aria-current={current === n.id ? 'page' : undefined} onClick={() => go(n.id)}>
                  {n.label}
                </button>
              ))}
            </nav>
          )}
          {user && <UserMenu user={user} onSignOut={signOut} />}
        </div>
      </header>
      <div className="notice">
        <div className="notice-inner">Simulation for training · educational clips · not for clinical use</div>
      </div>
      {notice && (
        <div className="toast" role="status">
          <span>{notice}</span>
          <button type="button" className="linklike" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      )}

      <main className="main">
        {!user && <AuthScreen onSignedIn={(u) => setUser(u)} />}
        {user && needsConsent && <ConsentScreen version={consentVersion} onDone={() => setUser({ ...user, consentVersion })} />}
        {user && !needsConsent && (
          <>
            {current === 'practice' && <Practice onProfile={() => go('profile')} />}
            {current === 'profile' && <Profile user={user} onPractice={() => go('practice')} />}
            {current === 'cohorts' && <Cohorts />}
            {current === 'cases' && <Cases role={user.role} />}
            {current === 'admin' && <Admin me={user} />}
          </>
        )}
      </main>
    </div>
  );
}

function UserMenu({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div className="trainee" ref={ref}>
      <button type="button" className="trainee-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="trainee-dot" aria-hidden="true" />
        {user.name}
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="menu-label">Signed in as</div>
          <div className="menu-who">
            <span>{user.email}</span>
            <span className="muted">{user.role === 'admin' ? 'Admin' : user.role === 'educator' ? 'Educator' : 'Trainee'}</span>
          </div>
          <div className="menu-sep" />
          <button type="button" role="menuitem" className="menu-item" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
