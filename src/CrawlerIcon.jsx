import React from 'react';

// Match the surrounding line icons while making crawler sources distinct from storage.
export function CrawlerIcon({ size = 20 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="crawler-icon">
    <circle cx="12" cy="7" r="2"/>
    <ellipse cx="12" cy="13" rx="3" ry="4"/>
    <path d="M10 10 6 7 5 3M9 12 4 10 2 6M9 14 4 16 2 20M10 16 7 19 7 22M14 10 18 7 19 3M15 12 20 10 22 6M15 14 20 16 22 20M14 16 17 19 17 22"/>
  </svg>;
}
