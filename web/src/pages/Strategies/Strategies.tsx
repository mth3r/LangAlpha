import React, { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import {
  listStrategies,
  createStrategy,
  updateStrategy,
  deleteStrategy,
  runStrategy,
  type Strategy,
  type RunStrategyResult,
} from './utils/api';
import StrategyList from './components/StrategyList';
import StrategyEditor from './components/StrategyEditor';
import BacktestRunner from './components/BacktestRunner';
import BacktestResults from './components/BacktestResults';
import './Strategies.css';

const NEW_STRATEGY: Strategy = {
  strategy_id: '',
  user_id: '',
  name: '',
  pine_script: '',
  python_code: null,
  description: null,
  created_at: '',
  updated_at: '',
};

export default function Strategies() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Strategy | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [backtestResult, setBacktestResult] = useState<RunStrategyResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const { data: strategies = [], isLoading } = useQuery({
    queryKey: ['strategies'],
    queryFn: listStrategies,
  });

  const createMutation = useMutation({
    mutationFn: ({ name, pine_script }: { name: string; pine_script: string }) =>
      createStrategy(name, pine_script),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['strategies'] });
      setSelected(created);
      setIsNew(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({
      strategyId,
      fields,
    }: {
      strategyId: string;
      fields: { name?: string; pine_script?: string };
    }) => updateStrategy(strategyId, fields),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ['strategies'] });
      setSelected(updated);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (strategyId: string) => deleteStrategy(strategyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['strategies'] });
      setSelected(null);
      setBacktestResult(null);
    },
  });

  const [isRunning, setIsRunning] = useState(false);

  const handleRun = useCallback(
    async (symbol: string, interval: string, fromDate?: string, toDate?: string) => {
      if (!selected?.strategy_id) return;
      setIsRunning(true);
      setRunError(null);
      setBacktestResult(null);
      try {
        const result = await runStrategy(
          selected.strategy_id,
          symbol,
          interval,
          fromDate,
          toDate
        );
        setBacktestResult(result);
      } catch (err: unknown) {
        const msg =
          err && typeof err === 'object' && 'response' in err
            ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
            : null;
        setRunError(msg || 'Failed to run strategy. Please try again.');
      } finally {
        setIsRunning(false);
      }
    },
    [selected]
  );

  const handleNewStrategy = () => {
    setSelected({ ...NEW_STRATEGY });
    setIsNew(true);
    setBacktestResult(null);
    setRunError(null);
  };

  const handleSelectStrategy = (s: Strategy) => {
    setSelected(s);
    setIsNew(false);
    setBacktestResult(null);
    setRunError(null);
  };

  const handleSave = (name: string, pine_script: string) => {
    if (isNew) {
      createMutation.mutate({ name, pine_script });
    } else if (selected?.strategy_id) {
      updateMutation.mutate({ strategyId: selected.strategy_id, fields: { name, pine_script } });
    }
  };

  const handleDelete = () => {
    if (selected?.strategy_id) {
      deleteMutation.mutate(selected.strategy_id);
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="strategies-page">
      {/* Left panel: strategy list */}
      <aside className="strategies-sidebar">
        <div className="strategies-sidebar-header">
          <span className="strategies-sidebar-title">Strategies</span>
          <button className="strategies-new-btn" onClick={handleNewStrategy} title="New strategy">
            <Plus size={16} />
          </button>
        </div>
        {isLoading ? (
          <div className="strategies-sidebar-empty">Loading…</div>
        ) : (
          <StrategyList
            strategies={strategies}
            selectedId={selected?.strategy_id ?? null}
            onSelect={handleSelectStrategy}
          />
        )}
      </aside>

      {/* Right panel: editor + backtest */}
      <main className="strategies-main">
        {selected !== null ? (
          <>
            <StrategyEditor
              strategy={selected}
              isNew={isNew}
              isSaving={isSaving}
              saveError={createMutation.error || updateMutation.error}
              onSave={handleSave}
              onDelete={handleDelete}
              isDeleting={deleteMutation.isPending}
            />
            {!isNew && selected.strategy_id && (
              <>
                <BacktestRunner
                  onRun={handleRun}
                  isRunning={isRunning}
                  disabled={!selected.python_code}
                />
                <BacktestResults
                  result={backtestResult}
                  error={runError}
                  isRunning={isRunning}
                />
              </>
            )}
          </>
        ) : (
          <div className="strategies-empty-state">
            <p>Select a strategy from the list or create a new one.</p>
            <button className="strategies-new-btn-large" onClick={handleNewStrategy}>
              <Plus size={18} /> New Strategy
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
