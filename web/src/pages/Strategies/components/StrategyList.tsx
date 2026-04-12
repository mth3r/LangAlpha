import React from 'react';
import type { Strategy } from '../utils/api';

interface Props {
  strategies: Strategy[];
  selectedId: string | null;
  onSelect: (s: Strategy) => void;
}

export default function StrategyList({ strategies, selectedId, onSelect }: Props) {
  if (strategies.length === 0) {
    return <div className="strategies-sidebar-empty">No strategies yet.</div>;
  }

  return (
    <ul className="strategies-list">
      {strategies.map((s) => (
        <li
          key={s.strategy_id}
          className={`strategies-list-item ${s.strategy_id === selectedId ? 'active' : ''}`}
          onClick={() => onSelect(s)}
        >
          <span className="strategies-list-name">{s.name}</span>
          {s.description && (
            <span className="strategies-list-desc">{s.description}</span>
          )}
        </li>
      ))}
    </ul>
  );
}
