import { parseWorkersCsv } from './csv-import';

describe('E3-S13 worker CSV parser', () => {
  it('parses name/rate/position in any order with quoted fields', () => {
    const csv = [
      'Position,Name,Rate',
      'Mason,"Torres, Ramon",650',
      'Laborer,Bong Reyes,',
      ',Third Guy,550.50',
    ].join('\n');
    const { rows, errors } = parseWorkersCsv(csv);
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { fullName: 'Torres, Ramon', position: 'Mason', dailyRate: 650 },
      { fullName: 'Bong Reyes', position: 'Laborer' },
      { fullName: 'Third Guy', dailyRate: 550.5 },
    ]);
  });

  it('reports row-level errors with the file line number', () => {
    const csv = ['name,rate', 'Good Guy,600', ',650', 'Bad Rate,abc'].join('\n');
    const { rows, errors } = parseWorkersCsv(csv);
    expect(rows).toHaveLength(1);
    expect(errors).toEqual([
      { line: 3, reason: 'Name is required' },
      {
        line: 4,
        reason: 'Rate "abc" is not a valid non-negative number',
      },
    ]);
  });

  it('requires the name column', () => {
    const { errors } = parseWorkersCsv('rate,position\n600,Mason');
    expect(errors[0].reason).toContain('name');
  });

  it('rejects more than 500 data rows', () => {
    const csv =
      'name\n' + Array.from({ length: 501 }, (_, i) => `W${i}`).join('\n');
    const { rows, errors } = parseWorkersCsv(csv);
    expect(rows).toEqual([]);
    expect(errors[0].reason).toContain('limit is 500');
  });

  it('skips blank lines and handles CRLF', () => {
    const { rows, errors } = parseWorkersCsv('name\r\nRamon\r\n\r\nBong\r\n');
    expect(errors).toEqual([]);
    expect(rows.map((r) => r.fullName)).toEqual(['Ramon', 'Bong']);
  });
});
