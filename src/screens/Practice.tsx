import { useCallback, useEffect, useState } from 'react';
import { api, type Feedback as FeedbackData, type NextCase } from '../api';
import { VideoClip } from '../components/VideoClip';
import {
  AiReadout,
  ConfidenceScale,
  MODE_HINT,
  MODE_LABEL,
  OptionList,
  OutcomeBadge,
  Pill,
  ReasonCodeTag,
  optionLabel,
} from '../components/ui';
import { DOMAIN_LABEL } from '../engine/config';
import { OUTCOME_SENTENCE } from '../engine/outcome';

type Phase = 'loading' | 'answer' | 'reveal' | 'feedback' | 'error';

export function Practice({ onProfile }: { onProfile: () => void }) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [next, setNext] = useState<NextCase | null>(null);
  const [feedback, setFeedback] = useState<FeedbackData | null>(null);
  const [answer, setAnswer] = useState<string | null>(null);
  const [conf, setConf] = useState<number | null>(null);
  const [conf2, setConf2] = useState<number | null>(null);
  const [ai, setAi] = useState<NextCase['ai'] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [whyOpen, setWhyOpen] = useState(false);

  const load = useCallback(async () => {
    setPhase('loading');
    setError(null);
    setFeedback(null);
    setAnswer(null);
    setConf(null);
    setConf2(null);
    setWhyOpen(false);
    try {
      const n = await api<NextCase>('/api/practice/next');
      setNext(n);
      setAi(n.ai ?? null);
      if (n.state === 'awaiting_final' && n.initial) {
        setAnswer(n.initial.answer);
        setConf(n.initial.confidence);
        setPhase('reveal');
      } else setPhase('answer');
      window.scrollTo({ top: 0 });
    } catch (e) {
      setError((e as Error).message);
      setPhase('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submitAnswer = async () => {
    if (!next || !answer || !conf) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ state: string; ai?: NextCase['ai']; feedback?: FeedbackData }>(`/api/practice/${next.decisionId}/answer`, {
        body: { answer, confidence: conf },
      });
      if (r.state === 'awaiting_final' && r.ai) {
        setAi(r.ai);
        setPhase('reveal');
      } else if (r.feedback) {
        setFeedback(r.feedback);
        setPhase('feedback');
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submitFinal = async (choice: 'keep' | 'ai') => {
    if (!next) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ feedback: FeedbackData }>(`/api/practice/${next.decisionId}/final`, {
        body: { choice, confidence: choice === 'keep' && ai?.answer === answer ? conf : conf2 ?? conf },
      });
      setFeedback(r.feedback);
      setPhase('feedback');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (phase === 'loading' && !next) return <div className="loading">Choosing your next case…</div>;
  if (phase === 'error' && !next)
    return (
      <div className="page">
        <div className="empty">
          <p>{error}</p>
          <button type="button" className="btn" onClick={() => void load()}>
            Try again
          </button>
        </div>
      </div>
    );
  if (!next) return null;

  const options = next.case.options;
  const agrees = ai && answer === ai.answer;

  return (
    <div className="workbench">
      <div className="case-bar">
        <div className="case-bar-main">
          <span className="case-no">Case {next.caseNumber}</span>
          <span className="case-domain">{DOMAIN_LABEL[next.case.domain]}</span>
          <Pill tone="accent">{MODE_LABEL[next.mode]}</Pill>
        </div>
        <button type="button" className="why" onClick={() => setWhyOpen((o) => !o)} aria-expanded={whyOpen}>
          Why this case?
        </button>
        {whyOpen && (
          <div className="why-panel">
            <ReasonCodeTag code={next.reasonCode} />
            <p>{next.explanation}</p>
          </div>
        )}
      </div>

      <div className="workbench-grid">
        <div className="scan-col">
          <VideoClip
            src={next.case.clipUrl}
            view={next.case.view}
            caption={`${next.case.view === 'A4C' ? 'Apical four-chamber view. Left ventricle on the right of the image.' : `${next.case.view} view.`} Use 0.5× to slow the loop.`}
          />
        </div>

        <div className="read-col">
          {phase === 'loading' && <div className="panel"><p className="muted">Loading the next case…</p></div>}

          {phase === 'answer' && (
            <div className="panel">
              <p className="mode-hint">{MODE_HINT[next.mode]}</p>
              {next.case.lookFor && (
                <div className="callout callout--tip">
                  <strong>What to look for</strong>
                  <p>{next.case.lookFor}</p>
                </div>
              )}
              {next.flags.calibrationPrompt && (
                <div className="callout callout--warn">
                  <strong>Second look</strong>
                  <p>Before you rate your confidence, name the one feature in the clip that supports your answer.</p>
                </div>
              )}
              {next.mode === 'ai-first' && ai && <AiReadout ai={{ ...ai, errorType: 'none' }} options={options} />}
              <h2 className="question">{next.case.question}</h2>
              <OptionList name={`ans-${next.decisionId}`} options={options} value={answer} onChange={setAnswer} />
              <ConfidenceScale name={`conf-${next.decisionId}`} value={conf} onChange={setConf} label="How sure are you?" />
              {error && <p className="form-error">{error}</p>}
              <button type="button" className="btn btn--primary" disabled={!answer || !conf || busy} onClick={submitAnswer}>
                {busy ? 'Saving…' : next.mode === 'human-first' ? 'Submit and see the AI read' : 'Submit'}
              </button>
            </div>
          )}

          {phase === 'reveal' && answer && ai && (
            <div className="panel">
              <div className="compare">
                <div className="your-read">
                  <span className="compare-label">Your read</span>
                  <span className="compare-value">{optionLabel(options, answer)}</span>
                  <span className="compare-meta">Confidence {conf}/5</span>
                </div>
                <AiReadout ai={{ ...ai, errorType: 'none' }} options={options} />
              </div>
              {agrees ? (
                <>
                  <p className="reveal-msg">The AI agrees with your read.</p>
                  {error && <p className="form-error">{error}</p>}
                  <button type="button" className="btn btn--primary" disabled={busy} onClick={() => submitFinal('keep')}>
                    Continue
                  </button>
                </>
              ) : (
                <>
                  <p className="reveal-msg">The AI disagrees with you. Look at the clip again, then decide.</p>
                  <ConfidenceScale name={`conf2-${next.decisionId}`} value={conf2} onChange={setConf2} label="How sure are you now of your own read?" />
                  {error && <p className="form-error">{error}</p>}
                  <div className="btn-row">
                    <button type="button" className="btn btn--primary" disabled={!conf2 || busy} onClick={() => submitFinal('keep')}>
                      Keep my answer
                    </button>
                    <button type="button" className="btn" disabled={!conf2 || busy} onClick={() => submitFinal('ai')}>
                      Change to the AI's answer
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {phase === 'feedback' && feedback && <Feedback fb={feedback} onNext={load} onProfile={onProfile} />}
        </div>
      </div>
    </div>
  );
}

function Feedback({ fb, onNext, onProfile }: { fb: FeedbackData; onNext: () => void; onProfile: () => void }) {
  const a = fb.attempt;
  const options = fb.case.options;
  const [reflection, setReflection] = useState<string | null>(a.reflection ?? null);
  const reflect = async (text: string) => {
    setReflection(text);
    try {
      await api(`/api/practice/attempts/${a.id}/reflection`, { body: { text } });
    } catch {
      /* optional */
    }
  };
  return (
    <div className="panel feedback">
      <div className="feedback-head">
        <OutcomeBadge outcome={a.outcome} />
        <p>{OUTCOME_SENTENCE[a.outcome]}</p>
      </div>
      <dl className="facts">
        <div>
          <dt>Reference answer</dt>
          <dd>{optionLabel(options, fb.case.answer)}</dd>
        </div>
        <div>
          <dt>{a.mode === 'human-first' ? 'Your first read' : 'Your answer'}</dt>
          <dd className={a.firstCorrect ? 'is-right' : 'is-wrong'}>
            {optionLabel(options, a.initialAnswer)} <span className="facts-meta">· {a.initialConfidence}/5</span>
          </dd>
        </div>
        {fb.ai && (
          <div>
            <dt>AI read</dt>
            <dd className={fb.ai.correct ? 'is-right' : 'is-wrong'}>
              {optionLabel(options, fb.ai.answer)} <span className="facts-meta">· {Math.round(fb.ai.confidence * 100)}%</span>
            </dd>
          </div>
        )}
        {a.mode === 'human-first' && (
          <div>
            <dt>Your final answer</dt>
            <dd className={a.finalCorrect ? 'is-right' : 'is-wrong'}>
              {optionLabel(options, a.finalAnswer)}
              {a.switched && <span className="facts-meta"> · changed</span>}
            </dd>
          </div>
        )}
      </dl>
      <div className="explain">
        <h3>Why</h3>
        <p>{fb.rationale}</p>
        <h3>What to look for</h3>
        <p>{fb.lookFor}</p>
      </div>
      {fb.reflectionPrompt && (
        <div className="callout callout--tip">
          <strong>Quick reflection: what made you change?</strong>
          <div className="chips">
            {fb.reflectionOptions.map((r) => (
              <button key={r} type="button" className={`chip${reflection === r ? ' is-selected' : ''}`} onClick={() => reflect(r)}>
                {r}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="btn-row">
        <button type="button" className="btn btn--primary" onClick={onNext}>
          Next case
        </button>
        <button type="button" className="btn btn--quiet" onClick={onProfile}>
          See my profile
        </button>
      </div>
      <p className="case-id">
        Case {fb.case.id} · pair {fb.case.pairId} · difficulty {fb.case.difficulty}/3 ·{' '}
        {fb.case.status === 'reviewed' ? 'clinician-reviewed' : 'draft content, not yet clinician-reviewed'}
      </p>
    </div>
  );
}
