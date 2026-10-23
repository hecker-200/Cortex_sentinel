import { useState } from 'react';
import { api, useApi, type Summary, type User } from '../api';
import { MetricTile, MODE_LABEL, OutcomeBadge, ReasonCodeTag, timeAgo } from '../components/ui';
import { DOMAIN_LABEL, DOMAINS } from '../engine/config';
import { pct, signedPts, type DomainMetrics } from '../engine/metrics';
import type { Domain, OutcomeClass } from '../types';

export function Profile({ user, onPractice }: { user: User; onPractice: () => void }) {
  const s = useApi<Summary>('/api/me/summary');
  const [code, setCode] = useState('');
  const [joinMsg, setJoinMsg] = useState<string | null>(null);

  const join = async (e: React.FormEvent) => {
    e.preventDefault();
    setJoinMsg(null);
    try {
      const r = await api<{ cohort: { name: string } }>('/api/cohorts/join', { body: { code } });
      setJoinMsg(`Joined ${r.cohort.name}.`);
      setCode('');
      void s.reload();
    } catch (err) {
      setJoinMsg((err as Error).message);
    }
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">My profile</p>
          <h1>{user.name}</h1>
          <p className="page-sub">
            {s.data ? `${s.data.total} cases answered. ` : ''}Every number shows how many cases it rests on (n). Numbers marked
            provisional rest on too few cases to mean much yet.
          </p>
        </div>
        <button type="button" className="btn btn--primary" onClick={onPractice}>
          Continue practice
        </button>
      </header>

      {s.error && <p className="form-error">{s.error}</p>}
      {s.loading && !s.data && <p className="muted">Loading…</p>}
      {s.data && s.data.total === 0 && (
        <div className="empty">
          <p>No cases yet. Your metrics appear here after your first case.</p>
        </div>
      )}
      {s.data && s.data.total > 0 && DOMAINS.map((d) => <DomainSection key={d} domain={d} metrics={s.data!.metrics[d]} />)}

      {s.data && s.data.decisions.length > 0 && (
        <section className="section">
          <h2>Why you got each case</h2>
          <p className="section-sub">The case picker follows fixed rules. Each choice is logged with a reason code.</p>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Case</th>
                  <th>Mode</th>
                  <th>Reason</th>
                  <th>Outcome</th>
                </tr>
              </thead>
              <tbody>
                {s.data.decisions.map((d) => (
                  <tr key={d.id}>
                    <td className="nowrap">{timeAgo(d.at)}</td>
                    <td className="mono">{d.caseId ?? '—'}</td>
                    <td>{MODE_LABEL[d.mode]}</td>
                    <td>
                      <ReasonCodeTag code={d.reasonCode} />
                      <div className="cell-sub">{d.explanation}</div>
                    </td>
                    <td>{d.outcome ? <OutcomeBadge outcome={d.outcome} /> : <span className="muted">In progress</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="section">
        <h2>Cohorts</h2>
        {s.data && s.data.cohorts.length > 0 ? (
          <p className="page-sub">You are in: {s.data.cohorts.map((c) => c.name).join(', ')}. Educators of these cohorts can see your results.</p>
        ) : (
          <p className="page-sub">You are not in a cohort. Your results are visible only to you and site admins.</p>
        )}
        <form className="inline-form" onSubmit={join}>
          <label htmlFor="join-code" className="sr-only">
            Cohort code
          </label>
          <input id="join-code" className="input input--code" placeholder="Cohort code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={12} />
          <button type="submit" className="btn" disabled={code.length < 4}>
            Join cohort
          </button>
          {joinMsg && <span className="muted">{joinMsg}</span>}
        </form>
      </section>

      <PasswordForm email={user.email} />
    </div>
  );
}

function PasswordForm({ email }: { email: string }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api('/api/me/password', { body: { current, next } });
      setCurrent('');
      setNext('');
      setMsg({ ok: true, text: 'Password changed.' });
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="section">
      <h2>Account</h2>
      <p className="page-sub">Signed in as {email}.</p>
      <form className="inline-form" onSubmit={submit}>
        <input type="email" autoComplete="username" value={email} readOnly hidden />
        <label htmlFor="pw-current" className="sr-only">
          Current password
        </label>
        <input id="pw-current" className="input" type="password" placeholder="Current password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        <label htmlFor="pw-next" className="sr-only">
          New password
        </label>
        <input id="pw-next" className="input" type="password" placeholder="New password (8+ characters)" autoComplete="new-password" minLength={8} value={next} onChange={(e) => setNext(e.target.value)} />
        <button type="submit" className="btn" disabled={busy || !current || next.length < 8}>
          Change password
        </button>
        {msg && <span className={msg.ok ? 'muted' : 'form-error'}>{msg.text}</span>}
      </form>
    </section>
  );
}

export function DomainSection({ domain, metrics: m }: { domain: Domain; metrics: DomainMetrics }) {
  return (
    <section className="section">
      <div className="section-head">
        <h2>{DOMAIN_LABEL[domain]}</h2>
        <span className="muted">{m.total} cases</span>
      </div>
      <div className="metrics">
        <MetricTile
          headline
          label="Error-catch rate"
          metric={m.errorCatch}
          format={pct}
          unit="AI errors"
          hint="Of the cases where the AI was wrong, how often you ended on the right answer."
        />
        <MetricTile
          label="Automation bias"
          metric={m.automationBias}
          format={pct}
          hint="When your first read was right and the AI was wrong, how often you switched to the AI."
        />
        <MetricTile label="Independent accuracy" metric={m.independentAccuracy} format={pct} hint="Your first reads, before any AI." />
        <MetricTile
          label="Assisted − unaided gap"
          metric={m.gap}
          format={signedPts}
          unit="pairs"
          hint="Accuracy with the AI shown minus accuracy without it, on matched case pairs."
        />
        <MetricTile
          label="Overconfidence"
          metric={m.calibration}
          format={pct}
          hint={`Share of your 4–5 confidence answers that were wrong (${m.calibration.highConfidenceCount} such answers).`}
        />
      </div>
      <RelianceMatrix counts={m.counts} />
    </section>
  );
}

const MATRIX: { row: string; cells: OutcomeClass[] }[] = [
  { row: 'AI was wrong', cells: ['caught-error', 'automation-bias', 'missed-error'] },
  { row: 'AI was right', cells: ['aligned', 'appropriate-reliance', 'under-reliance'] },
];

export function RelianceMatrix({ counts }: { counts: Partial<Record<OutcomeClass, number>> }) {
  return (
    <div className="matrix" aria-label="Reliance matrix, human-first cases">
      <div className="matrix-title">Reliance matrix · human-first cases</div>
      {MATRIX.map((r) => (
        <div className="matrix-row" key={r.row}>
          <div className="matrix-rowlabel">{r.row}</div>
          {r.cells.map((cell) => (
            <div className="matrix-cell" key={cell}>
              <span className="matrix-n">{counts[cell] ?? 0}</span>
              <OutcomeBadge outcome={cell} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
