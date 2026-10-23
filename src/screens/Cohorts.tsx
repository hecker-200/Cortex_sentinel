import { useState } from 'react';
import { api, useApi, type CohortDetail as Detail, type CohortListItem } from '../api';
import { Pill, ReasonCodeTag, timeAgo } from '../components/ui';
import { DOMAIN_LABEL, DOMAINS } from '../engine/config';
import { pct, signedPts } from '../engine/metrics';
import type { Domain } from '../types';

export function Cohorts() {
  const list = useApi<CohortListItem[]>('/api/cohorts');
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const c = await api<{ id: string }>('/api/cohorts', { body: { name } });
      setName('');
      await list.reload();
      setSelected(c.id);
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const demo = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const c = await api<{ id: string }>('/api/admin/demo-cohort', { method: 'POST' });
      await list.reload();
      setSelected(c.id);
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (selected)
    return (
      <CohortDetail
        id={selected}
        onBack={() => {
          setSelected(null);
          void list.reload();
        }}
      />
    );

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">Educator</p>
          <h1>Cohorts</h1>
          <p className="page-sub">
            Create a cohort and share its code. Trainees enter the code when they sign up or on their profile page, and their
            results appear here. For teaching only, never for grades.
          </p>
        </div>
      </header>

      <form className="inline-form" onSubmit={create}>
        <label htmlFor="cohort-name" className="sr-only">
          Cohort name
        </label>
        <input id="cohort-name" className="input" placeholder="e.g. EM residents, Jan 2027" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        <button type="submit" className="btn btn--primary" disabled={!name.trim() || busy}>
          Create cohort
        </button>
        <button type="button" className="btn btn--quiet" onClick={demo} disabled={busy}>
          Add a simulated demo cohort
        </button>
        {msg && <span className="form-error">{msg}</span>}
      </form>

      {list.error && <p className="form-error">{list.error}</p>}
      {list.data && list.data.length === 0 && (
        <div className="empty">
          <p>No cohorts yet. Create one above, or add the simulated demo cohort to see how this view reads with data.</p>
        </div>
      )}
      {list.data && list.data.length > 0 && (
        <div className="table-wrap">
          <table className="table table--select">
            <thead>
              <tr>
                <th>Cohort</th>
                <th>Join code</th>
                <th className="num">Trainees</th>
                <th>Owner</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((c) => (
                <tr key={c.id} onClick={() => setSelected(c.id)}>
                  <td>
                    <button type="button" className="linklike" onClick={() => setSelected(c.id)}>
                      {c.name}
                    </button>{' '}
                    {c.isDemo && <Pill>Simulated</Pill>}
                  </td>
                  <td className="mono">{c.joinCode}</td>
                  <td className="num">{c.members}</td>
                  <td>{c.ownerName}</td>
                  <td className="nowrap">{timeAgo(c.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CohortDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const [domain, setDomain] = useState<Domain>('lv');
  const d = useApi<Detail>(`/api/cohorts/${id}?domain=${domain}`);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [copied, setCopied] = useState(false);
  const inviteUrl = d.data ? `${window.location.origin}/?join=${d.data.cohort.joinCode}` : '';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const remove = async () => {
    await api(`/api/cohorts/${id}`, { method: 'DELETE' });
    onBack();
  };

  return (
    <div className="page">
      <button type="button" className="linklike back" onClick={onBack}>
        ← All cohorts
      </button>
      {d.error && <p className="form-error">{d.error}</p>}
      {d.data && (
        <>
          <header className="page-head">
            <div>
              <p className="eyebrow">Cohort {d.data.cohort.isDemo && '· simulated trainees'}</p>
              <h1>{d.data.cohort.name}</h1>
              <div className="invite">
                <span>
                  Join code <strong className="mono code-big">{d.data.cohort.joinCode}</strong>
                </span>
                <span className="muted mono invite-url">{inviteUrl}</span>
                <button type="button" className="btn btn--sm" onClick={copy}>
                  {copied ? 'Copied' : 'Copy invite link'}
                </button>
              </div>
            </div>
            <div className="seg" role="tablist" aria-label="Domain">
              {DOMAINS.map((x) => (
                <button key={x} type="button" role="tab" aria-selected={domain === x} className={`seg-btn${domain === x ? ' is-on' : ''}`} onClick={() => setDomain(x)}>
                  {DOMAIN_LABEL[x]}
                </button>
              ))}
            </div>
          </header>

          <div className="stats">
            <div className="stat">
              <span className="stat-n">{d.data.totals.members}</span>
              <span className="stat-l">trainees</span>
            </div>
            <div className="stat">
              <span className="stat-n">{d.data.totals.attempts}</span>
              <span className="stat-l">cases answered</span>
            </div>
            <div className="stat">
              <span className="stat-n">{d.data.totals.seededShown}</span>
              <span className="stat-l">wrong AI reads shown</span>
            </div>
            <div className="stat">
              <span className="stat-n">{pct(d.data.totals.caughtRate)}</span>
              <span className="stat-l">of AI errors caught</span>
            </div>
          </div>

          <section className="section">
            <h2>{DOMAIN_LABEL[domain]} by trainee</h2>
            {d.data.rows.length === 0 ? (
              <div className="empty">
                <p>No trainees yet. Share the join code or invite link.</p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Trainee</th>
                      <th className="num">Cases</th>
                      <th className="num">Error-catch</th>
                      <th className="num">Automation bias</th>
                      <th className="num">Independent acc.</th>
                      <th className="num">Gap</th>
                      <th className="num">Overconfidence</th>
                      <th>Latest rule</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.data.rows.map(({ id: uid, name, simulated, cases, metrics: m, lastReason }) => (
                      <tr key={uid}>
                        <td>
                          {name.replace(/^Sim · /, '')} {simulated && <Pill>Sim</Pill>}
                        </td>
                        <td className="num">{cases}</td>
                        <Cell v={pct(m.errorCatch.value)} n={m.errorCatch.n} prov={m.errorCatch.provisional} tone={!m.errorCatch.provisional && (m.errorCatch.value ?? 1) < 0.6 ? 'crit' : undefined} />
                        <Cell v={pct(m.automationBias.value)} n={m.automationBias.n} prov={m.automationBias.provisional} tone={!m.automationBias.provisional && (m.automationBias.value ?? 0) >= 0.4 ? 'crit' : undefined} />
                        <Cell v={pct(m.independentAccuracy.value)} n={m.independentAccuracy.n} prov={m.independentAccuracy.provisional} tone={!m.independentAccuracy.provisional && (m.independentAccuracy.value ?? 1) < 0.6 ? 'warn' : undefined} />
                        <Cell v={signedPts(m.gap.value)} n={m.gap.n} prov={m.gap.provisional} />
                        <Cell v={pct(m.calibration.value)} n={m.calibration.n} prov={m.calibration.provisional} tone={!m.calibration.provisional && (m.calibration.value ?? 0) >= 0.3 ? 'warn' : undefined} />
                        <td>{lastReason ? <ReasonCodeTag code={lastReason} /> : <span className="muted">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="section-sub">Small grey numbers are n. Faded values are provisional. Red and amber mark values past the policy thresholds.</p>
          </section>

          <section className="section">
            <h2>Cases where trainees most often follow the wrong AI</h2>
            <p className="section-sub">Human-first cases where the AI was seeded wrong, across this cohort. Good candidates for teaching.</p>
            {d.data.caseStats.length === 0 ? (
              <div className="empty">
                <p>No seeded-error cases answered yet.</p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Case</th>
                      <th>Domain</th>
                      <th>Wrong AI read</th>
                      <th className="num">Shown wrong</th>
                      <th className="num">Followed AI</th>
                      <th className="num">Caught</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.data.caseStats.map((r) => (
                      <tr key={r.caseId}>
                        <td className="mono">{r.caseId}</td>
                        <td>{r.domain ? DOMAIN_LABEL[r.domain] : '—'}</td>
                        <td>
                          {r.wrongLabel} <span className="cell-sub">· {r.errorType?.replace('-', ' ')}</span>
                        </td>
                        <td className="num">{r.seeded}</td>
                        <td className="num">{r.ab}</td>
                        <td className="num">{r.caught}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="section">
            <h2>Export and settings</h2>
            <p className="section-sub">The CSV has one row per answered case. Trainees appear as T001, T002… with no names or emails.</p>
            <div className="btn-row">
              <a className="btn" href={`/api/cohorts/${id}/export.csv`} download>
                Download CSV
              </a>
              {confirmDelete ? (
                <>
                  <button type="button" className="btn btn--danger" onClick={remove}>
                    {d.data.cohort.isDemo ? 'Delete cohort and simulated trainees' : 'Delete cohort (trainee accounts stay)'}
                  </button>
                  <button type="button" className="btn btn--quiet" onClick={() => setConfirmDelete(false)}>
                    Cancel
                  </button>
                </>
              ) : (
                <button type="button" className="btn btn--quiet" onClick={() => setConfirmDelete(true)}>
                  Delete cohort
                </button>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function Cell({ v, n, prov, tone }: { v: string; n: number; prov: boolean; tone?: 'crit' | 'warn' }) {
  return (
    <td className={`num${prov ? ' is-prov' : ''}${tone ? ` tone-${tone}` : ''}`}>
      {v} <span className="n">{n}</span>
    </td>
  );
}
