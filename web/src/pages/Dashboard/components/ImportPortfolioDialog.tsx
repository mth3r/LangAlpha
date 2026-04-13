import React, { useRef, useState } from 'react';
import { Download, Upload, CheckCircle, AlertCircle, X } from 'lucide-react';
import {
  downloadTemplate,
  previewImport,
  confirmImport,
  type ImportPreviewResponse,
} from '../utils/portfolio';

interface Props {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}

type Stage = 'upload' | 'preview' | 'done';

export default function ImportPortfolioDialog({ open, onClose, onImported }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null);
  const [result, setResult] = useState<{ imported: number; skipped: number; errors: string[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const reset = () => {
    setStage('upload');
    setFile(null);
    setPreview(null);
    setResult(null);
    setError(null);
    setLoading(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleClose = () => { reset(); onClose(); };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setError(null);
    setLoading(true);
    try {
      const p = await previewImport(f);
      setPreview(p);
      setStage('preview');
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Failed to parse file');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const r = await confirmImport(file);
      setResult(r);
      setStage('done');
      onImported();
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Import failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background border border-border rounded-lg w-full max-w-2xl mx-4 shadow-xl flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-base font-semibold">Import Portfolio from CSV</h2>
          <button onClick={handleClose} className="text-muted-foreground hover:text-foreground">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-5 space-y-4">

          {/* Stage: upload */}
          {stage === 'upload' && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Download the template, fill it in (Google Sheets, Excel, or any CSV editor), then upload it here.
                Split adjustments are applied automatically based on your purchase dates.
              </p>

              <button
                onClick={downloadTemplate}
                className="flex items-center gap-2 text-sm px-3 py-2 rounded border border-border hover:bg-accent transition-colors"
              >
                <Download size={15} />
                Download CSV Template
              </button>

              <div className="text-xs text-muted-foreground bg-muted/40 rounded p-3 font-mono">
                symbol, shares, purchase_price, purchase_date, account, notes<br />
                AAPL, 10, 150.00, 2022-01-15, Robinhood, (optional)<br />
                NVDA, 5, 220.00, 2023-06-01, Fidelity,
              </div>

              <div
                className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => fileRef.current?.click()}
              >
                <Upload size={24} className="mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm font-medium">Click to upload CSV</p>
                <p className="text-xs text-muted-foreground mt-1">or drag and drop</p>
                {file && <p className="text-xs text-primary mt-2">{file.name}</p>}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={handleFile}
              />

              {loading && <p className="text-sm text-muted-foreground">Parsing and fetching split data…</p>}
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
          )}

          {/* Stage: preview */}
          {stage === 'preview' && preview && (
            <div className="space-y-3">
              <div className="flex items-center gap-4 text-sm">
                <span className="text-green-500 font-medium">{preview.total} valid rows</span>
                {preview.errors > 0 && (
                  <span className="text-destructive font-medium">{preview.errors} errors</span>
                )}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="text-left py-2 pr-3">Symbol</th>
                      <th className="text-right py-2 pr-3">Orig Shares</th>
                      <th className="text-right py-2 pr-3">Orig Price</th>
                      <th className="text-left py-2 pr-3">Purchase Date</th>
                      <th className="text-right py-2 pr-3">Split Ratio</th>
                      <th className="text-right py-2 pr-3">Adj Shares</th>
                      <th className="text-right py-2 pr-3">Adj Price</th>
                      <th className="text-left py-2">Account</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row, i) => (
                      <tr key={i} className={`border-b border-border/50 ${row.error ? 'text-destructive' : ''}`}>
                        {row.error ? (
                          <td colSpan={8} className="py-2 pr-3">
                            <AlertCircle size={12} className="inline mr-1" />{row.error}
                          </td>
                        ) : (
                          <>
                            <td className="py-2 pr-3 font-medium">{row.symbol}</td>
                            <td className="py-2 pr-3 text-right">{row.shares}</td>
                            <td className="py-2 pr-3 text-right">${row.purchase_price.toFixed(2)}</td>
                            <td className="py-2 pr-3">{row.purchase_date}</td>
                            <td className={`py-2 pr-3 text-right ${row.split_ratio !== 1 ? 'text-amber-500 font-medium' : 'text-muted-foreground'}`}>
                              {row.split_ratio !== 1 ? `${row.split_ratio}×` : '—'}
                            </td>
                            <td className="py-2 pr-3 text-right font-medium">{row.adjusted_shares}</td>
                            <td className="py-2 pr-3 text-right font-medium">${row.adjusted_price.toFixed(2)}</td>
                            <td className="py-2 text-muted-foreground">{row.account || '—'}</td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
          )}

          {/* Stage: done */}
          {stage === 'done' && result && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-green-500">
                <CheckCircle size={18} />
                <span className="font-medium">{result.imported} holdings imported</span>
              </div>
              {result.skipped > 0 && (
                <p className="text-sm text-muted-foreground">{result.skipped} rows skipped</p>
              )}
              {result.errors.length > 0 && (
                <div className="text-xs text-destructive space-y-1">
                  {result.errors.map((e, i) => <p key={i}>{e}</p>)}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
          {stage === 'upload' && (
            <button onClick={handleClose} className="text-sm px-4 py-2 rounded border border-border hover:bg-accent">
              Cancel
            </button>
          )}
          {stage === 'preview' && (
            <>
              <button onClick={reset} className="text-sm px-4 py-2 rounded border border-border hover:bg-accent">
                Back
              </button>
              <button
                onClick={handleConfirm}
                disabled={loading || preview?.total === 0}
                className="text-sm px-4 py-2 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {loading ? 'Importing…' : `Import ${preview?.total} Holdings`}
              </button>
            </>
          )}
          {stage === 'done' && (
            <button onClick={handleClose} className="text-sm px-4 py-2 rounded bg-primary text-primary-foreground hover:bg-primary/90">
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
