import React, { useState, useEffect } from 'react';
import { Save, Trash2, Loader2 } from 'lucide-react';
import type { Strategy } from '../utils/api';

interface Props {
  strategy: Strategy;
  isNew: boolean;
  isSaving: boolean;
  saveError: Error | null;
  isDeleting: boolean;
  onSave: (name: string, pine_script: string) => void;
  onDelete: () => void;
}

export default function StrategyEditor({
  strategy,
  isNew,
  isSaving,
  saveError,
  isDeleting,
  onSave,
  onDelete,
}: Props) {
  const [name, setName] = useState(strategy.name);
  const [pineScript, setPineScript] = useState(strategy.pine_script);

  // Sync form fields when selected strategy changes
  useEffect(() => {
    setName(strategy.name);
    setPineScript(strategy.pine_script);
  }, [strategy.strategy_id, strategy.name, strategy.pine_script]);

  const handleSave = () => {
    if (!name.trim() || !pineScript.trim()) return;
    onSave(name.trim(), pineScript.trim());
  };

  const isDirty =
    name !== strategy.name || pineScript !== strategy.pine_script;

  return (
    <section className="strategy-editor">
      <div className="strategy-editor-header">
        <input
          className="strategy-name-input"
          placeholder="Strategy name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="strategy-editor-actions">
          {!isNew && (
            <button
              className="strategy-btn strategy-btn-danger"
              onClick={onDelete}
              disabled={isDeleting}
              title="Delete strategy"
            >
              {isDeleting ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
            </button>
          )}
          <button
            className="strategy-btn strategy-btn-primary"
            onClick={handleSave}
            disabled={isSaving || !name.trim() || !pineScript.trim()}
            title="Save & translate"
          >
            {isSaving ? (
              <>
                <Loader2 size={14} className="spin" /> Translating…
              </>
            ) : (
              <>
                <Save size={14} /> {isNew ? 'Save & Translate' : isDirty ? 'Update & Translate' : 'Saved'}
              </>
            )}
          </button>
        </div>
      </div>

      {saveError && (
        <div className="strategy-error">
          Failed to save strategy. Please try again.
        </div>
      )}

      {strategy.description && !isNew && (
        <div className="strategy-description">{strategy.description}</div>
      )}

      <textarea
        className="strategy-pine-editor"
        placeholder={`//@version=5\nstrategy("My Strategy", overlay=true)\n\n// Paste your Pine Script here`}
        value={pineScript}
        onChange={(e) => setPineScript(e.target.value)}
        spellCheck={false}
      />
    </section>
  );
}
