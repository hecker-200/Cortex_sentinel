import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { CaseItem } from '../src/types';
import type { Db } from './db';

/**
 * On first start, loads the draft case bank from seed/cases.json and any clip
 * found at seed/clips/<case id>.mp4 (or .webm). Later edits happen in the admin screens.
 */
export async function seedCases(db: Db, seedDir: string): Promise<number> {
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM cases`);
  if (Number(rows[0].n) > 0) return 0;
  const file = path.join(seedDir, 'cases.json');
  if (!existsSync(file)) return 0;
  const cases = JSON.parse(readFileSync(file, 'utf8')) as CaseItem[];
  for (const c of cases) {
    const found = (['mp4', 'webm'] as const).find((ext) => existsSync(path.join(seedDir, 'clips', `${c.id}.${ext}`)));
    const clip = found ? readFileSync(path.join(seedDir, 'clips', `${c.id}.${found}`)) : null;
    await db.query(
      `INSERT INTO cases (id, pair_id, domain, question, options, answer, difficulty, rationale, look_for, ai_correct, ai_wrong,
         status, view_label, clip_mime, clip_data, clip_source)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10::jsonb,$11::jsonb,'draft',$12,$13,$14,$15)`,
      [
        c.id, c.pairId, c.domain, c.question, JSON.stringify(c.options), c.answer, c.difficulty, c.rationale, c.lookFor,
        JSON.stringify(c.ai.correct), JSON.stringify(c.ai.wrong), c.clip.view ?? 'A4C',
        clip ? `video/${found}` : null, clip, clip ? 'synthetic placeholder (generated)' : null,
      ],
    );
  }
  return cases.length;
}
