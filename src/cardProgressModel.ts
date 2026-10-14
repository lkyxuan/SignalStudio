import type { CardProgress } from './contracts';
import standard from '../catalog/card-review.v1.json';

export const labels:Record<string,[string,string]> = Object.fromEntries(standard.statuses.map(s=>[s.id,[s.label_zh,s.label_en]]));
export function progressStatus(progress?:CardProgress) {
  if(progress?.stale || !progress?.report) return 'unknown';
  if(progress.status && labels[progress.status]) return progress.status;
  const state=progress.report.observations.implementation;
  return ({implemented:'pending_review',verified:'pending_review',not_implemented:'incomplete',
    not_started:'incomplete',in_progress:'incomplete',partial:'incomplete',disputed:'discussion',mismatch:'mismatch'} as Record<string,string>)[state || ''] || 'unknown';
}
