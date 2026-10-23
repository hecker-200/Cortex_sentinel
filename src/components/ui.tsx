import type { ReactNode } from 'react';
import type { AIOutput, CaseOption, Mode, OutcomeClass, ReasonCode } from '../types';
import { OUTCOME_LABEL, OUTCOME_TONE, type Tone } from '../engine/outcome';
import type { Metric } from '../engine/metrics';

export const CONF_LABELS = ['Guessing', 'Unsure', 'Fairly sure', 'Confident', 'Certain'];

export const MODE_LABEL: Record<Mode, string> = {
  'human-first': 'Human-first',
  'ai-first': 'AI-first',
  unaided: 'Unaided',
  guided: 'Guided',
};

export const MODE_HINT: Record<Mode, string> = {
  'human-first': 'Commit your read. The AI answer appears after you submit.',
  'ai-first': 'The AI read is shown from the start, as in an AI-assisted workflow.',
  unaided: 'No AI on this case.',
  guided: 'No AI on this case. Read the tip first.',
};

export function Pill({ tone = 'neutral', children }: { tone?: Tone | 'accent'; children: ReactNode }) {
  return <span className={`pill pill--${tone}`}>{children}</span>;
}

export function OutcomeBadge({ outcome }: { outcome: OutcomeClass }) {
  return <Pill tone={OUTCOME_TONE[outcome]}>{OUTCOME_LABEL[outcome]}</Pill>;
}

export function ReasonCodeTag({ code }: { code: ReasonCode }) {
  return <code className="reason">{code}</code>;
}

export function OptionList(props: {
  name: string;
  options: CaseOption[];
  value: string | null;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="options" role="radiogroup" aria-label="Your answer">
      {props.options.map((o) => (
        <label key={o.value} className={`option${props.value === o.value ? ' is-selected' : ''}`}>
          <input
            type="radio"
            id={`${props.name}-${o.value}`}
            name={props.name}
            value={o.value}
            checked={props.value === o.value}
            disabled={props.disabled}
            onChange={() => props.onChange(o.value)}
          />
          <span>{o.label}</span>
        </label>
      ))}
    </div>
  );
}

export function ConfidenceScale(props: { name: string; value: number | null; onChange: (v: number) => void; label: string }) {
  return (
    <fieldset className="confidence">
      <legend>{props.label}</legend>
      <div className="confidence-row">
        {CONF_LABELS.map((l, i) => (
          <label key={l} className={`conf${props.value === i + 1 ? ' is-selected' : ''}`}>
            <input
              type="radio"
              id={`${props.name}-${i + 1}`}
              name={props.name}
              checked={props.value === i + 1}
              onChange={() => props.onChange(i + 1)}
            />
            <span className="conf-n">{i + 1}</span>
            <span className="conf-l">{l}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function AiReadout({ ai, options, verdict }: { ai: AIOutput; options: CaseOption[]; verdict?: 'right' | 'wrong' }) {
  const label = options.find((o) => o.value === ai.answer)?.label ?? ai.answer;
  return (
    <div className={`ai-readout${verdict ? ` is-${verdict}` : ''}`}>
      <div className="ai-head">
        <span className="ai-src">AI read</span>
        <span className="ai-conf">{Math.round(ai.confidence * 100)}% confidence</span>
      </div>
      <div className="ai-answer">{label}</div>
      {verdict && <div className="ai-verdict">{verdict === 'right' ? 'The AI was right' : 'The AI was wrong'}</div>}
    </div>
  );
}

export function MetricTile(props: { label: string; metric: Metric; format: (v: number | null) => string; hint: string; headline?: boolean; unit?: string }) {
  const { metric } = props;
  return (
    <div className={`metric${props.headline ? ' metric--headline' : ''}`}>
      <div className="metric-label">{props.label}</div>
      <div className="metric-value">{props.format(metric.value)}</div>
      <div className="metric-meta">
        <span>n = {metric.n}{props.unit ? ` ${props.unit}` : ''}</span>
        {metric.provisional && <Pill tone="neutral">Provisional</Pill>}
      </div>
      <div className="metric-hint">{props.hint}</div>
    </div>
  );
}

export function optionLabel(options: CaseOption[], v: string | null) {
  if (!v) return '—';
  return options.find((o) => o.value === v)?.label ?? v;
}

export function timeAgo(ts: number) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ts).toLocaleDateString();
}
