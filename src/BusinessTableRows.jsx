import React from 'react';

function CellValue({ name, value, displayDecimalPlaces }) {
  if (value == null) return <span className="business-table-null">NULL</span>;
  if (typeof value === 'number' && Number.isFinite(value) && displayDecimalPlaces != null) {
    return <code>{value.toFixed(displayDecimalPlaces)}</code>;
  }
  if (name.endsWith('_json')) {
    let formatted = value;
    try { formatted = JSON.stringify(JSON.parse(value), null, 2); } catch { /* Show the stored text. */ }
    return <details className="business-table-json"><summary><code>{value.length > 50 ? `${value.slice(0, 50)}…` : value}</code></summary>
      <pre>{formatted}</pre></details>;
  }
  return <code>{String(value)}</code>;
}

export function BusinessTableRows({ table, rows, language }) {
  return <div className="business-table-schema-scroll" role="region" aria-label={language === 'zh-CN' ? '表行' : 'Table rows'}><table className="business-table-raw">
    <thead><tr>{table.columns.map(column => <th key={column.name} title={language === 'zh-CN' ? column.label_zh : column.name}><code>{column.name}</code></th>)}</tr></thead>
    <tbody>{rows.map(row => <tr key={table.primary_key.map(key => row[key]).join(':')}>
      {table.columns.map(column => <td key={column.name}><CellValue name={column.name} value={row[column.name]} displayDecimalPlaces={column.display_decimal_places} /></td>)}
    </tr>)}</tbody>
  </table></div>;
}
