export interface CsvRowError {
  line: number;
  reason: string;
}

export interface ParsedWorkerRow {
  fullName: string;
  dailyRate?: number;
  position?: string;
}

export const CSV_MAX_ROWS = 500;

/**
 * E3-S13: accepts name/rate/position columns (any order, case-insensitive
 * headers). Row-level errors carry the 1-based file line number so the UI
 * can highlight them.
 */
export function parseWorkersCsv(csv: string): {
  rows: ParsedWorkerRow[];
  errors: CsvRowError[];
} {
  const lines = csv
    .split(/\r?\n/)
    .map((l, i) => ({ raw: l, line: i + 1 }))
    .filter((l) => l.raw.trim().length > 0);

  if (lines.length === 0) {
    return { rows: [], errors: [{ line: 1, reason: 'File is empty' }] };
  }

  const headers = splitCsvLine(lines[0].raw).map((h) =>
    h.trim().toLowerCase(),
  );
  const nameIdx = headers.indexOf('name');
  const rateIdx = headers.indexOf('rate');
  const positionIdx = headers.indexOf('position');
  if (nameIdx === -1) {
    return {
      rows: [],
      errors: [{ line: 1, reason: 'Missing required "name" column' }],
    };
  }

  const dataLines = lines.slice(1);
  if (dataLines.length > CSV_MAX_ROWS) {
    return {
      rows: [],
      errors: [
        {
          line: 1,
          reason: `Too many rows (${dataLines.length}); the limit is ${CSV_MAX_ROWS}`,
        },
      ],
    };
  }

  const rows: ParsedWorkerRow[] = [];
  const errors: CsvRowError[] = [];
  for (const { raw, line } of dataLines) {
    const cells = splitCsvLine(raw);
    const fullName = (cells[nameIdx] ?? '').trim();
    if (!fullName) {
      errors.push({ line, reason: 'Name is required' });
      continue;
    }
    const row: ParsedWorkerRow = { fullName };
    if (rateIdx !== -1 && (cells[rateIdx] ?? '').trim() !== '') {
      const rate = Number((cells[rateIdx] ?? '').trim());
      if (!Number.isFinite(rate) || rate < 0) {
        errors.push({
          line,
          reason: `Rate "${cells[rateIdx]?.trim()}" is not a valid non-negative number`,
        });
        continue;
      }
      row.dailyRate = rate;
    }
    if (positionIdx !== -1 && (cells[positionIdx] ?? '').trim() !== '') {
      row.position = (cells[positionIdx] ?? '').trim();
    }
    rows.push(row);
  }
  return { rows, errors };
}

/** Minimal CSV field splitter with double-quote support. */
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      cells.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells;
}
