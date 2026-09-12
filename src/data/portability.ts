/**
 * Export and import.
 *
 * Development Master section 32 makes this non-optional: there is exactly one
 * copy of the user's data, on one machine, with no server redundancy behind it.
 * A manual export is the only thing standing between a wiped browser profile
 * and losing everything.
 *
 * Principle 1 of the spec — "Malek owns the data. It lives on his machine, in a
 * format he can export at any time" — is why the export is plain JSON covering
 * every table, including AI memory and usage logs, so "what does this app know
 * about me" is always answerable.
 */

import { STORES, type StoreName } from './schema';
import { store } from './store';
import { DB_VERSION } from './db';
import { AppError, toAppError } from './errors';
import { getApiKey } from '../ai/provider';

export interface ExportBundle {
  format: 'life-os-export';
  version: number;
  exportedAt: string;
  counts: Record<string, number>;
  data: Partial<Record<StoreName, unknown[]>>;
}

/**
 * Builds the full export.
 *
 * Soft-deleted rows are included deliberately: an export is a backup, and a
 * backup that silently drops recoverable data is not a backup.
 *
 * The Groq API key is NOT included. It is a credential, not user data, and
 * putting it in a file that gets emailed around or synced to a cloud drive
 * would be the single worst thing this function could do.
 */
export function buildExport(): ExportBundle {
  const data: Partial<Record<StoreName, unknown[]>> = {};
  const counts: Record<string, number> = {};

  for (const name of Object.values(STORES) as StoreName[]) {
    const rows = store.get(name as never) as unknown[];
    data[name] = rows;
    counts[name] = rows.length;
  }

  return {
    format: 'life-os-export',
    version: DB_VERSION,
    exportedAt: new Date().toISOString(),
    counts,
    data,
  };
}

/** Serialised export, pretty-printed so it stays readable in a text editor. */
export function exportToJson(): string {
  return JSON.stringify(buildExport(), null, 2);
}

/** Approximate size of the export, for the Settings label. */
export function exportSizeLabel(): string {
  const bytes = new Blob([exportToJson()]).size;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Triggers a browser download of the export. */
export function downloadExport(): void {
  const json = exportToJson();
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `life-os-backup-${stamp}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Revoke on the next tick so the download has started.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Exports a single table as CSV, for spreadsheet use. */
export function downloadCsv(name: StoreName): void {
  const rows = store.get(name as never) as Array<Record<string, unknown>>;
  if (rows.length === 0) throw new AppError('NOT_FOUND', 'There is nothing in that table to export.');

  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const escape = (value: unknown): string => {
    if (value == null) return '';
    const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
    // Quote anything containing a delimiter, quote or newline.
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const csv = [
    columns.join(','),
    ...rows.map((row) => columns.map((col) => escape(row[col])).join(',')),
  ].join('\n');

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `life-os-${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ------------------------------------------------------------------ *
 * Import
 * ------------------------------------------------------------------ */

export interface ImportPreview {
  exportedAt: string;
  version: number;
  counts: Record<string, number>;
  total: number;
  warnings: string[];
}

/**
 * Parses and validates an export file without applying it.
 *
 * Import replaces everything, so the user sees exactly what is in the file and
 * how many rows it will restore before agreeing to it.
 */
export function parseImport(text: string): { preview: ImportPreview; bundle: ExportBundle } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AppError('VALIDATION_ERROR', 'That file is not valid JSON.');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new AppError('VALIDATION_ERROR', 'That file is not a Life OS export.');
  }

  const bundle = parsed as ExportBundle;
  if (bundle.format !== 'life-os-export') {
    throw new AppError(
      'VALIDATION_ERROR',
      'That file is not a Life OS export. Look for a life-os-backup-….json file.',
    );
  }
  if (!bundle.data || typeof bundle.data !== 'object') {
    throw new AppError('VALIDATION_ERROR', 'That export has no data in it.');
  }

  const warnings: string[] = [];
  if (bundle.version > DB_VERSION) {
    warnings.push(
      `This export came from a newer version of Life OS (schema ${bundle.version} vs ${DB_VERSION}). Some fields may not be understood.`,
    );
  }

  const counts: Record<string, number> = {};
  let total = 0;
  const known = new Set<string>(Object.values(STORES));

  for (const [name, rows] of Object.entries(bundle.data)) {
    if (!known.has(name)) {
      warnings.push(`Unknown table "${name}" in the file — it will be ignored.`);
      continue;
    }
    if (!Array.isArray(rows)) {
      warnings.push(`Table "${name}" is malformed and will be skipped.`);
      continue;
    }
    // Every row needs an id, or it cannot be stored against its key path.
    const valid = rows.filter((row) => row && typeof row === 'object' && 'id' in row);
    if (valid.length !== rows.length) {
      warnings.push(`${rows.length - valid.length} row(s) in "${name}" have no id and will be skipped.`);
    }
    counts[name] = valid.length;
    total += valid.length;
  }

  if (total === 0) {
    throw new AppError('VALIDATION_ERROR', 'That export contains no usable rows.');
  }

  return {
    bundle,
    preview: {
      exportedAt: bundle.exportedAt ?? 'unknown',
      version: bundle.version ?? 0,
      counts,
      total,
      warnings,
    },
  };
}

/**
 * Applies an import, replacing all current data.
 *
 * Destructive by design — a partial merge between two snapshots of the same
 * single-user database would produce duplicates and contradictory XP history,
 * which is worse than an honest replace. The confirmation dialog says so.
 */
export async function applyImport(bundle: ExportBundle): Promise<void> {
  const clean: Partial<Record<StoreName, unknown[]>> = {};
  const known = new Set<string>(Object.values(STORES));

  for (const [name, rows] of Object.entries(bundle.data)) {
    if (!known.has(name) || !Array.isArray(rows)) continue;
    clean[name as StoreName] = rows.filter((row) => row && typeof row === 'object' && 'id' in row);
  }

  try {
    await store.replaceAll(clean);
  } catch (err) {
    throw toAppError(err);
  }
}

/** Whether an API key is present, so Settings can say what the export omits. */
export function hasApiKey(): boolean {
  return getApiKey() != null;
}
