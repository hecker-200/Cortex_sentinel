import { useEffect, useMemo, useState } from 'react';
import { api, useApi, type AdminCase, type Role } from '../api';
import { VideoClip } from '../components/VideoClip';
import { AiReadout, Pill, optionLabel, timeAgo } from '../components/ui';
import { DOMAIN_LABEL, DOMAINS } from '../engine/config';
import type { CaseOption, Domain, ErrorType } from '../types';

export function Cases({ role }: { role: Role }) {
  const list = useApi<AdminCase[]>('/api/admin/cases');
  const [filter, setFilter] = useState<'all' | Domain | 'draft'>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminCase | 'new' | null>(null);
  const isAdmin = role === 'admin';

  const cases = list.data ?? [];
  const shown = cases.filter((c) => filter === 'all' || c.domain === filter || (filter === 'draft' && c.status === 'draft'));
  const selected = cases.find((c) => c.id === selectedId) ?? shown[0] ?? null;
  const counts = useMemo(
    () => ({ reviewed: cases.filter((c) => c.status === 'reviewed').length, live: cases.filter((c) => c.active && c.hasClip).length }),
    [cases],
  );

  const replace = (c: AdminCase) => list.setData((prev) => (prev ? (prev.some((x) => x.id === c.id) ? prev.map((x) => (x.id === c.id ? c : x)) : [...prev, c]) : [c]));

  if (editing)
    return (
      <CaseEditor
        initial={editing === 'new' ? null : editing}
        existingIds={cases.map((c) => c.id)}
        onCancel={() => setEditing(null)}
        onSaved={(c) => {
          replace(c);
          setSelectedId(c.id);
          setEditing(null);
        }}
      />
    );

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">Case bank</p>
          <h1>{cases.length} cases</h1>
          <p className="page-sub">
            {counts.live} are live in practice (active with a clip). {counts.reviewed} are signed off by a clinician. Any edit or new
            clip sends a case back to draft until it is signed off again.
          </p>
        </div>
        <div className="btn-row">
          <div className="seg" role="tablist" aria-label="Filter">
            {(['all', ...DOMAINS, 'draft'] as const).map((f) => (
              <button key={f} type="button" role="tab" aria-selected={filter === f} className={`seg-btn${filter === f ? ' is-on' : ''}`} onClick={() => setFilter(f)}>
                {f === 'all' ? 'All' : f === 'draft' ? 'Needs review' : DOMAIN_LABEL[f]}
              </button>
            ))}
          </div>
          {isAdmin && (
            <button type="button" className="btn btn--primary" onClick={() => setEditing('new')}>
              New case
            </button>
          )}
        </div>
      </header>
      {list.error && <p className="form-error">{list.error}</p>}

      <div className="bank">
        <div className="table-wrap bank-list">
          <table className="table table--select">
            <thead>
              <tr>
                <th>Case</th>
                <th>Answer</th>
                <th className="num">Diff.</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((x) => (
                <tr key={x.id} className={x.id === selected?.id ? 'is-selected' : ''} onClick={() => setSelectedId(x.id)}>
                  <td className="mono">
                    <button type="button" className="linklike" onClick={() => setSelectedId(x.id)}>
                      {x.id}
                    </button>
                  </td>
                  <td>{optionLabel(x.options, x.answer).replace(/ \(.*\)/, '')}</td>
                  <td className="num">{x.difficulty}</td>
                  <td className="nowrap">
                    <Pill tone={x.status === 'reviewed' ? 'good' : 'warn'}>{x.status === 'reviewed' ? 'Reviewed' : 'Draft'}</Pill>
                    {!x.active && <Pill>Off</Pill>}
                    {!x.hasClip && <Pill tone="crit">No clip</Pill>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {selected && <CaseDetail key={selected.id} c={selected} isAdmin={isAdmin} onChange={replace} onEdit={() => setEditing(selected)} />}
      </div>
    </div>
  );
}

function CaseDetail({ c, isAdmin, onChange, onEdit }: { c: AdminCase; isAdmin: boolean; onChange: (c: AdminCase) => void; onEdit: () => void }) {
  const [note, setNote] = useState(c.reviewNote ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const review = async (status: 'reviewed' | 'draft') => {
    setBusy(true);
    setMsg(null);
    try {
      onChange(await api<AdminCase>(`/api/admin/cases/${encodeURIComponent(c.id)}/review`, { body: { status, note: note || undefined } }));
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file: File) => {
    setBusy(true);
    setMsg(null);
    try {
      const type = file.type || 'video/mp4';
      onChange(
        await api<AdminCase>(`/api/admin/cases/${encodeURIComponent(c.id)}/clip`, {
          method: 'PUT',
          raw: file,
          contentType: type,
          headers: { 'X-Clip-Source': file.name.slice(0, 200) },
        }),
      );
      setMsg('Clip uploaded. The case is back in draft until signed off.');
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bank-detail">
      {c.hasClip ? (
        <VideoClip src={c.clip.kind === 'video' ? c.clip.src : ''} view={c.viewLabel} caption={c.clipSource ? `Clip source: ${c.clipSource}` : undefined} />
      ) : (
        <div className="scan scan--empty">
          <p>No clip yet. This case is not used in practice until it has one.</p>
        </div>
      )}
      <div className="bank-meta">
        <span className="mono">{c.id}</span>
        <span>pair {c.pairId}</span>
        <span>{DOMAIN_LABEL[c.domain]}</span>
        <span>difficulty {c.difficulty}/3</span>
        <span>v{c.version}</span>
        <Pill tone={c.status === 'reviewed' ? 'good' : 'warn'}>
          {c.status === 'reviewed' ? `Signed off by ${c.reviewedByName ?? 'a reviewer'}${c.reviewedAt ? `, ${timeAgo(c.reviewedAt)}` : ''}` : 'Draft · needs review'}
        </Pill>
        {!c.active && <Pill>Not in practice</Pill>}
      </div>
      <h2 className="question">{c.question}</h2>
      <p>
        <strong>Reference answer:</strong> {optionLabel(c.options, c.answer)}
      </p>
      <div className="bank-ai">
        <AiReadout ai={c.ai.correct} options={c.options} verdict="right" />
        <AiReadout ai={c.ai.wrong} options={c.options} verdict="wrong" />
      </div>
      <div className="explain">
        <h3>Rationale</h3>
        <p>{c.rationale}</p>
        <h3>What to look for</h3>
        <p>{c.lookFor}</p>
      </div>

      <div className="review-box">
        <h3>Clinical review</h3>
        <label htmlFor={`note-${c.id}`} className="field-help">
          Review note (optional, saved with the sign-off)
        </label>
        <textarea id={`note-${c.id}`} className="input textarea" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
        <div className="btn-row">
          {c.status === 'draft' ? (
            <button type="button" className="btn btn--primary" disabled={busy || !c.hasClip} onClick={() => review('reviewed')}>
              Sign off this case
            </button>
          ) : (
            <button type="button" className="btn" disabled={busy} onClick={() => review('draft')}>
              Reopen for review
            </button>
          )}
          {isAdmin && (
            <>
              <button type="button" className="btn" onClick={onEdit}>
                Edit case
              </button>
              <label className="btn btn--quiet file-btn">
                {c.hasClip ? 'Replace clip' : 'Upload clip'}
                <input
                  type="file"
                  accept="video/mp4,video/webm,video/quicktime"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void upload(f);
                    e.target.value = '';
                  }}
                />
              </label>
            </>
          )}
        </div>
        {msg && <p className="muted">{msg}</p>}
      </div>
    </div>
  );
}

const ERROR_TYPES: { value: Exclude<ErrorType, 'none'>; label: string }[] = [
  { value: 'missed-finding', label: 'Missed finding' },
  { value: 'over-call', label: 'Over-call' },
  { value: 'wrong-grade', label: 'Wrong grade' },
];

const TEMPLATES: Record<Domain, { question: string; options: CaseOption[]; lookFor: string }> = {
  lv: {
    question: 'How is left ventricular systolic function on this clip?',
    options: [
      { value: 'normal', label: 'Normal (EF ≥ 50%)' },
      { value: 'reduced', label: 'Reduced (EF 30–49%)' },
      { value: 'severe', label: 'Severely reduced (EF < 30%)' },
    ],
    lookFor: 'Compare the left ventricular cavity at end-diastole and end-systole, and watch whether the walls thicken as they move inward.',
  },
  effusion: {
    question: 'Is a pericardial effusion present?',
    options: [
      { value: 'present', label: 'Effusion present' },
      { value: 'absent', label: 'No effusion' },
    ],
    lookFor: 'Look for a black (echo-free) band between the heart muscle and the bright pericardial line.',
  },
};

function CaseEditor({ initial, existingIds, onCancel, onSaved }: { initial: AdminCase | null; existingIds: string[]; onCancel: () => void; onSaved: (c: AdminCase) => void }) {
  const t = TEMPLATES.lv;
  const [id, setId] = useState(initial?.id ?? '');
  const [pairId, setPairId] = useState(initial?.pairId ?? '');
  const [domain, setDomain] = useState<Domain>(initial?.domain ?? 'lv');
  const [question, setQuestion] = useState(initial?.question ?? t.question);
  const [options, setOptions] = useState<CaseOption[]>(initial?.options ?? t.options);
  const [answer, setAnswer] = useState(initial?.answer ?? t.options[0].value);
  const [difficulty, setDifficulty] = useState(initial?.difficulty ?? 1);
  const [rationale, setRationale] = useState(initial?.rationale ?? '');
  const [lookFor, setLookFor] = useState(initial?.lookFor ?? t.lookFor);
  const [viewLabel, setViewLabel] = useState(initial?.viewLabel ?? 'A4C');
  const [active, setActive] = useState(initial?.active ?? true);
  const [aiCorrectConf, setAiCorrectConf] = useState(Math.round((initial?.ai.correct.confidence ?? 0.9) * 100));
  const [aiWrongAnswer, setAiWrongAnswer] = useState(initial?.ai.wrong.answer ?? t.options[1].value);
  const [aiWrongConf, setAiWrongConf] = useState(Math.round((initial?.ai.wrong.confidence ?? 0.75) * 100));
  const [aiWrongType, setAiWrongType] = useState<Exclude<ErrorType, 'none'>>((initial?.ai.wrong.errorType as Exclude<ErrorType, 'none'>) ?? 'over-call');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep answer choices valid when options change
  useEffect(() => {
    const vals = options.map((o) => o.value);
    if (!vals.includes(answer)) setAnswer(vals[0] ?? '');
    if (!vals.includes(aiWrongAnswer) || aiWrongAnswer === answer) setAiWrongAnswer(vals.find((v) => v !== answer) ?? '');
  }, [options, answer, aiWrongAnswer]);

  const applyTemplate = (d: Domain) => {
    setDomain(d);
    if (!initial) {
      setQuestion(TEMPLATES[d].question);
      setOptions(TEMPLATES[d].options);
      setLookFor(TEMPLATES[d].lookFor);
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      id,
      pairId,
      domain,
      question,
      options,
      answer,
      difficulty,
      rationale,
      lookFor,
      viewLabel,
      active,
      aiCorrect: { answer, confidence: aiCorrectConf / 100, errorType: 'none' },
      aiWrong: { answer: aiWrongAnswer, confidence: aiWrongConf / 100, errorType: aiWrongType },
    };
    try {
      const saved = initial
        ? await api<AdminCase>(`/api/admin/cases/${encodeURIComponent(initial.id)}`, { method: 'PUT', body })
        : await api<AdminCase>('/api/admin/cases', { body });
      onSaved(saved);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page page--narrow">
      <button type="button" className="linklike back" onClick={onCancel}>
        ← Back to case bank
      </button>
      <form className="form" onSubmit={save}>
        <h1>{initial ? `Edit ${initial.id}` : 'New case'}</h1>
        {initial && <p className="callout callout--warn">Saving content changes sends this case back to draft until it is signed off again.</p>}
        <div className="form-grid">
          <div className="field">
            <label htmlFor="f-id">Case ID</label>
            <input id="f-id" className="input mono" value={id} onChange={(e) => setId(e.target.value)} disabled={Boolean(initial)} required pattern="[A-Za-z0-9_\-]{2,40}" />
            {!initial && existingIds.includes(id) && <span className="form-error">This ID is taken</span>}
          </div>
          <div className="field">
            <label htmlFor="f-pair">Pair ID</label>
            <input id="f-pair" className="input mono" value={pairId} onChange={(e) => setPairId(e.target.value)} required />
            <span className="field-help">Two cases with the same pair ID, answer and difficulty form a matched pair.</span>
          </div>
          <div className="field">
            <label htmlFor="f-domain">Domain</label>
            <select id="f-domain" className="input" value={domain} onChange={(e) => applyTemplate(e.target.value as Domain)}>
              {DOMAINS.map((d) => (
                <option key={d} value={d}>
                  {DOMAIN_LABEL[d]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-diff">Difficulty</label>
            <select id="f-diff" className="input" value={difficulty} onChange={(e) => setDifficulty(Number(e.target.value) as 1 | 2 | 3)}>
              <option value={1}>1 · clear</option>
              <option value={2}>2 · moderate</option>
              <option value={3}>3 · borderline</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-view">View label</label>
            <input id="f-view" className="input" value={viewLabel} onChange={(e) => setViewLabel(e.target.value)} maxLength={20} />
          </div>
          <label className="check field--check">
            <input id="f-active" type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            <span>Use in practice</span>
          </label>
        </div>

        <div className="field">
          <label htmlFor="f-q">Question</label>
          <input id="f-q" className="input" value={question} onChange={(e) => setQuestion(e.target.value)} required />
        </div>

        <fieldset className="fieldset">
          <legend>Answer options</legend>
          {options.map((o, i) => (
            <div className="option-row" key={i}>
              <input
                aria-label={`Option ${i + 1} value`}
                className="input mono"
                value={o.value}
                onChange={(e) => setOptions(options.map((x, j) => (j === i ? { ...x, value: e.target.value.trim() } : x)))}
                placeholder="value"
              />
              <input
                aria-label={`Option ${i + 1} label`}
                className="input"
                value={o.label}
                onChange={(e) => setOptions(options.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                placeholder="Label shown to trainees"
              />
              <button type="button" className="btn btn--quiet btn--sm" disabled={options.length <= 2} onClick={() => setOptions(options.filter((_, j) => j !== i))}>
                Remove
              </button>
            </div>
          ))}
          <button type="button" className="btn btn--sm" disabled={options.length >= 6} onClick={() => setOptions([...options, { value: '', label: '' }])}>
            Add option
          </button>
        </fieldset>

        <div className="form-grid">
          <div className="field">
            <label htmlFor="f-answer">Reference answer</label>
            <select id="f-answer" className="input" value={answer} onChange={(e) => setAnswer(e.target.value)}>
              {options.filter((o) => o.value).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label || o.value}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-aic">AI confidence when right (%)</label>
            <input id="f-aic" className="input" type="number" min={50} max={99} value={aiCorrectConf} onChange={(e) => setAiCorrectConf(Number(e.target.value))} />
          </div>
        </div>

        <fieldset className="fieldset">
          <legend>Seeded wrong AI read</legend>
          <p className="field-help">Make it plausible: an error a real model could make on this clip.</p>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="f-aiw">AI says</label>
              <select id="f-aiw" className="input" value={aiWrongAnswer} onChange={(e) => setAiWrongAnswer(e.target.value)}>
                {options.filter((o) => o.value && o.value !== answer).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label || o.value}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="f-aiwt">Error type</label>
              <select id="f-aiwt" className="input" value={aiWrongType} onChange={(e) => setAiWrongType(e.target.value as Exclude<ErrorType, 'none'>)}>
                {ERROR_TYPES.map((x) => (
                  <option key={x.value} value={x.value}>
                    {x.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="f-aiwc">AI confidence when wrong (%)</label>
              <input id="f-aiwc" className="input" type="number" min={50} max={99} value={aiWrongConf} onChange={(e) => setAiWrongConf(Number(e.target.value))} />
            </div>
          </div>
        </fieldset>

        <div className="field">
          <label htmlFor="f-rat">Rationale shown after the case</label>
          <textarea id="f-rat" className="input textarea" rows={4} value={rationale} onChange={(e) => setRationale(e.target.value)} required minLength={10} />
        </div>
        <div className="field">
          <label htmlFor="f-look">What to look for</label>
          <textarea id="f-look" className="input textarea" rows={3} value={lookFor} onChange={(e) => setLookFor(e.target.value)} required minLength={10} />
        </div>

        {error && <p className="form-error">{error}</p>}
        <div className="btn-row">
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? 'Saving…' : initial ? 'Save changes' : 'Create case'}
          </button>
          <button type="button" className="btn btn--quiet" onClick={onCancel}>
            Cancel
          </button>
        </div>
        {!initial && <p className="field-help">After creating the case, upload its clip from the case bank.</p>}
      </form>
    </div>
  );
}
