/**
 * Collapsible SQL preview panel for an indicator version.
 *
 * Displays the generated parameterized MySQL query alongside its
 * resolved parameter values and the computed period dates.
 * Uses a monospace font with syntax-highlighting via CSS classes
 * for SQL keywords to improve readability.
 */

import { useState, type ReactElement } from 'react';
import { useSQLPreview } from '@/features/indicadores/hooks';
import LoadingState from './LoadingState';
import ErrorState from './ErrorState';

// ── SQL Keyword Highlighting ─────────────────────────────────────────────

const SQL_KEYWORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'EXISTS',
  'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'ON',
  'COUNT', 'DISTINCT', 'AS', 'BETWEEN',
  'GROUP BY', 'HAVING', 'ORDER BY', 'LIMIT', 'OFFSET',
  'DATE_ADD', 'DATEDIFF', 'INTERVAL',
  'INSERT', 'UPDATE', 'DELETE', 'SET', 'VALUES',
  'CREATE', 'ALTER', 'DROP', 'TABLE', 'INDEX',
  'YEAR', 'MONTH', 'DAY',
]);

/**
 * Wrap SQL keywords in <span class="kw"> tags for highlighting.
 */
function highlightSQL(sql: string): string {
  // Escape HTML entities first
  const escaped = sql
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Build a regex that matches whole-word keywords (case-insensitive)
  // Group BY and ORDER BY are two-word keywords; match them as phrases.
  const phrasePatterns = [...SQL_KEYWORDS].sort((a, b) => b.length - a.length);
  const escapedPhrases = phrasePatterns.map((k) =>
    k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  );
  const regex = new RegExp(`\\b(${escapedPhrases.join('|')})\\b`, 'gi');

  return escaped.replace(regex, '<span class="sql-kw">$1</span>');
}

// ── Props ────────────────────────────────────────────────────────────────

interface SQLPreviewSectionProps {
  /** Indicator UUID */
  indicadorId: string;
  /** Specific version UUID — undefined means latest */
  versionId?: string;
  /** Version number for display label */
  versionNum?: number;
}

// ── Component ────────────────────────────────────────────────────────────

export default function SQLPreviewSection({
  indicadorId,
  versionId,
  versionNum,
}: SQLPreviewSectionProps): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const { data, isLoading, isError, error } = useSQLPreview(
    indicadorId,
    versionId,
  );

  return (
    <div className="mt-4 rounded-md border border-gray-300 bg-gray-50">
      {/* Toggle header */}
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-gray-700 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-inset"
        aria-expanded={expanded}
        aria-controls={`sql-preview-body-${versionId ?? 'latest'}`}
      >
        <span>
          🔍 SQL generado
          {versionNum !== undefined && (
            <span className="ml-2 text-xs text-gray-500">
              (versión #{versionNum})
            </span>
          )}
        </span>
        <span className="text-xs text-gray-400">
          {expanded ? '▲ Ocultar' : '▼ Ver'}
        </span>
      </button>

      {/* Expandable body */}
      {expanded && (
        <div
          id={`sql-preview-body-${versionId ?? 'latest'}`}
          className="border-t border-gray-300 px-4 py-3"
        >
          {isLoading ? (
            <LoadingState message="Generando SQL…" />
          ) : isError ? (
            <ErrorState
              message={error?.message ?? 'Error al generar la vista previa del SQL'}
            />
          ) : data ? (
            <div className="space-y-3">
              {/* Period info */}
              <div className="text-xs text-gray-500">
                Período:{' '}
                <span className="font-medium text-gray-700">
                  {data.periodo_inicio} → {data.periodo_fin}
                </span>
              </div>

              {/* SQL block */}
              <div>
                <p className="mb-1 text-xs font-medium text-gray-600">
                  Consulta SQL:
                </p>
                <pre
                  className="overflow-x-auto rounded-md bg-gray-900 p-3 text-xs leading-relaxed text-green-300"
                  dangerouslySetInnerHTML={{
                    __html: highlightSQL(data.sql),
                  }}
                />
                <style>{`
                  .sql-kw {
                    color: #93c5fd; /* blue-300 */
                    font-weight: 600;
                  }
                `}</style>
              </div>

              {/* Params block */}
              <div>
                <p className="mb-1 text-xs font-medium text-gray-600">
                  Parámetros:
                </p>
                {Object.keys(data.params).length > 0 ? (
                  <pre className="overflow-x-auto rounded-md bg-gray-100 p-3 text-xs leading-relaxed text-gray-700">
                    {JSON.stringify(data.params, null, 2)}
                  </pre>
                ) : (
                  <p className="text-xs text-gray-400 italic">
                    Sin parámetros
                  </p>
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-400 italic">
              No se pudo obtener la vista previa.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
