import React from 'react';
import { KaitoMcpObserved } from './KaitoMcpObserved';

export function KaitoSourceFields({ data, language }) {
  return <KaitoMcpObserved data={{ observed_at: data.mcp_observed_at, tools: data.mcp_observed_tools || [] }} language={language} compact />;
}
