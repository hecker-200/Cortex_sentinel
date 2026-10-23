import { useState } from 'react';
import { api, useApi, type AdminUser, type AuditEntry, type PolicyCheck, type Role, type User } from '../api';
import { Pill, ReasonCodeTag, timeAgo } from '../components/ui';

type Tab = 'users' | 'checks' | 'activity';

export function Admin({ me }: { me: User }) {
  const [tab, setTab] = useState<Tab>('users');
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">Admin</p>
          <h1>Site administration</h1>
        </div>
        <div className="seg" role="tablist" aria-label="Admin section">
          {(
            [
              ['users', 'Users'],
              ['checks', 'Policy checks'],
              ['activity', 'Activity log'],
            ] as const
          ).map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={`seg-btn${tab === k ? ' is-on' : ''}`} onClick={() => setTab(k)}>
              {label}
            </button>
          ))}
        </div>
      </header>
      {tab === 'users' && <Users me={me} />}
      {tab === 'checks' && <Checks />}
      {tab === 'activity' && <Activity />}
    </div>
  );
}

function Users({ me }: { me: User }) {
  const u = useApi<AdminUser[]>('/api/admin/users');
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [temp, setTemp] = useState<{ name: string; tempPassword: string } | null>(null);
  const issueTemp = async (id: string) => {
    setConfirmId(null);
    try {
      setTemp(await api<{ name: string; tempPassword: string }>(`/api/admin/users/${id}/temp-password`, { method: 'POST' }));
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  const setRole = async (id: string, role: Role) => {
    setMsg(null);
    try {
      await api(`/api/admin/users/${id}/role`, { method: 'PUT', body: { role } });
      u.setData((prev) => prev?.map((x) => (x.id === id ? { ...x, role } : x)) ?? null);
      setMsg('Role updated.');
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  return (
    <section className="section">
      <p className="section-sub">
        Trainees practise. Educators create cohorts, see their cohorts' results and sign off cases. Admins also edit cases, upload
        clips and manage roles.
      </p>
      {msg && <p className="muted">{msg}</p>}
      {temp && (
        <div className="callout callout--warn">
          <strong>Temporary password for {temp.name}</strong>
          <p>
            <code className="code-big">{temp.tempPassword}</code>
          </p>
          <p>Give it to them directly. It is shown only once. They are signed out everywhere and should change it on their profile page.</p>
          <button type="button" className="linklike" onClick={() => setTemp(null)}>
            Done
          </button>
        </div>
      )}
      {u.error && <p className="form-error">{u.error}</p>}
      {u.data && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th className="num">Cases</th>
                <th>Joined</th>
                <th>Role</th>
                <th>Password</th>
              </tr>
            </thead>
            <tbody>
              {u.data.map((x) => (
                <tr key={x.id}>
                  <td>
                    {x.name} {!x.consented && <Pill>No consent yet</Pill>}
                  </td>
                  <td className="mono">{x.email}</td>
                  <td className="num">{x.attempts}</td>
                  <td className="nowrap">{timeAgo(x.createdAt)}</td>
                  <td>
                    <label className="sr-only" htmlFor={`role-${x.id}`}>
                      Role for {x.name}
                    </label>
                    <select id={`role-${x.id}`} className="input input--sm" value={x.role} disabled={x.id === me.id} onChange={(e) => setRole(x.id, e.target.value as Role)}>
                      <option value="trainee">Trainee</option>
                      <option value="educator">Educator</option>
                      <option value="admin">Admin</option>
                    </select>
                  </td>
                  <td className="nowrap">
                    {x.id === me.id ? (
                      <span className="muted">Use your profile</span>
                    ) : confirmId === x.id ? (
                      <>
                        <button type="button" className="btn btn--danger btn--sm" onClick={() => issueTemp(x.id)}>
                          Reset now
                        </button>{' '}
                        <button type="button" className="btn btn--quiet btn--sm" onClick={() => setConfirmId(null)}>
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button type="button" className="btn btn--sm" onClick={() => setConfirmId(x.id)}>
                        Issue temporary password
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Checks() {
  const [data, setData] = useState<PolicyCheck[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      setData(await api<PolicyCheck[]>('/api/admin/policy-checks'));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="section">
      <p className="section-sub">
        Runs five simulated trainees through 40 cases each on the live case bank and checks that each one triggers the rule it
        should. Run this after editing cases or thresholds.
      </p>
      <div className="btn-row">
        <button type="button" className="btn btn--primary" onClick={run} disabled={busy}>
          {busy ? 'Running…' : 'Run policy checks'}
        </button>
      </div>
      {err && <p className="form-error">{err}</p>}
      {data && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Persona</th>
                <th>Behaviour</th>
                <th>Expected rule</th>
                <th>Result</th>
                <th>Rules fired</th>
              </tr>
            </thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.key}>
                  <td className="nowrap">{c.name}</td>
                  <td>{c.description}</td>
                  <td>{c.expected ? <ReasonCodeTag code={c.expected} /> : <span className="muted">None</span>}</td>
                  <td className="nowrap">
                    {c.passed === null ? <Pill>Info</Pill> : c.passed ? <Pill tone="good">Pass · case {c.firstFiredAt}</Pill> : <Pill tone="crit">Fail</Pill>}
                  </td>
                  <td className="cell-sub">{c.rulesFired.join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const ACTION_LABEL: Record<string, string> = {
  'user.signup': 'Account created',
  'user.role': 'Role changed',
  'user.temp-password': 'Temporary password issued',
  'cohort.create': 'Cohort created',
  'cohort.delete': 'Cohort deleted',
  'cohort.demo': 'Demo cohort added',
  'cohort.export': 'CSV exported',
  'case.create': 'Case created',
  'case.update': 'Case edited',
  'case.clip': 'Clip uploaded',
  'case.signoff': 'Case signed off',
  'case.reopen': 'Case reopened',
  'case.pack': 'Case pack imported',
};

function Activity() {
  const a = useApi<AuditEntry[]>('/api/admin/audit');
  return (
    <section className="section">
      <p className="section-sub">The last 100 changes to accounts, cohorts and cases.</p>
      {a.error && <p className="form-error">{a.error}</p>}
      {a.data && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>What</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {a.data.map((x) => (
                <tr key={x.id}>
                  <td className="nowrap">{timeAgo(x.at)}</td>
                  <td>{x.userName ?? '—'}</td>
                  <td>{ACTION_LABEL[x.action] ?? x.action}</td>
                  <td className="cell-sub mono">
                    {Object.entries(x.detail)
                      .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
                      .join(' · ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
