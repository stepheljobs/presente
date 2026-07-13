/**
 * E7-S14/S15/S16: lightweight export builders (no native deps).
 * CSV for register; SpreadsheetML XML for Excel; minimal PDF text pages.
 */

export interface ExportLine {
  workerName: string;
  daysPresent: number;
  halfdays: number;
  otHours: number;
  adjustments: number;
  gross: number;
  dailyRate: number;
  siteName?: string;
}

export function toCsv(lines: ExportLine[]): string {
  const header =
    'Worker,Days,Halfdays,OT Hours,Daily Rate,Adjustments,Gross';
  const rows = lines.map((l) =>
    [
      csvEscape(l.workerName),
      l.daysPresent,
      l.halfdays,
      l.otHours,
      l.dailyRate,
      l.adjustments,
      l.gross,
    ].join(','),
  );
  return [header, ...rows].join('\n') + '\n';
}

function csvEscape(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Excel-friendly SpreadsheetML 2003 XML. */
export function toXlsxXml(lines: ExportLine[]): string {
  const rows = lines
    .map(
      (l) => `
    <Row>
      <Cell><Data ss:Type="String">${xml(l.workerName)}</Data></Cell>
      <Cell><Data ss:Type="Number">${l.daysPresent}</Data></Cell>
      <Cell><Data ss:Type="Number">${l.halfdays}</Data></Cell>
      <Cell><Data ss:Type="Number">${l.otHours}</Data></Cell>
      <Cell><Data ss:Type="Number">${l.dailyRate}</Data></Cell>
      <Cell><Data ss:Type="Number">${l.adjustments}</Data></Cell>
      <Cell><Data ss:Type="Number">${l.gross}</Data></Cell>
    </Row>`,
    )
    .join('');
  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="Payroll">
  <Table>
    <Row>
      <Cell><Data ss:Type="String">Worker</Data></Cell>
      <Cell><Data ss:Type="String">Days</Data></Cell>
      <Cell><Data ss:Type="String">Halfdays</Data></Cell>
      <Cell><Data ss:Type="String">OT Hours</Data></Cell>
      <Cell><Data ss:Type="String">Daily Rate</Data></Cell>
      <Cell><Data ss:Type="String">Adjustments</Data></Cell>
      <Cell><Data ss:Type="String">Gross</Data></Cell>
    </Row>${rows}
  </Table>
 </Worksheet>
</Workbook>`;
}

function xml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Minimal single-page-per-chunk PDF (text only) for signature sheets / payslips. */
export function toSimplePdf(title: string, bodyLines: string[]): Buffer {
  const lines = [title, '', ...bodyLines];
  const content = lines
    .map((line, i) => {
      const y = 800 - i * 14;
      const safe = line.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
      return `BT /F1 10 Tf 40 ${y} Td (${safe}) Tj ET`;
    })
    .join('\n');

  const objects: string[] = [];
  objects.push('1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n');
  objects.push('2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n');
  objects.push(
    '3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>endobj\n',
  );
  objects.push(
    `4 0 obj<< /Length ${Buffer.byteLength(content)} >>stream\n${content}\nendstream\nendobj\n`,
  );
  objects.push('5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n');

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += obj;
  }
  const xrefPos = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i < offsets.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
  return Buffer.from(pdf, 'utf8');
}

export function signatureSheetPdf(
  siteName: string,
  period: string,
  lines: ExportLine[],
): Buffer {
  const body = [
    `Site: ${siteName}`,
    `Period: ${period}`,
    '',
    'Worker                         Days    Gross      Signature',
    '----------------------------------------------------------------',
    ...lines.map(
      (l) =>
        `${l.workerName.padEnd(28).slice(0, 28)} ${String(l.daysPresent).padStart(4)}  ${peso(l.gross).padStart(10)}  ___________`,
    ),
  ];
  return toSimplePdf('Presente — Payroll Signature Sheet', body);
}

export function payslipPdf(
  workerName: string,
  period: string,
  line: ExportLine,
): Buffer {
  return toSimplePdf(`Payslip — ${workerName}`, [
    `Worker: ${workerName}`,
    `Period: ${period}`,
    '',
    `Daily rate: ${peso(line.dailyRate)}`,
    `Days present: ${line.daysPresent}`,
    `Halfdays: ${line.halfdays}`,
    `OT hours: ${line.otHours}`,
    `Adjustments: ${peso(line.adjustments)}`,
    `--------------------------------`,
    `Gross pay: ${peso(line.gross)}`,
    '',
    'This is a gross-pay slip (no statutory deductions).',
    'Print this PDF or open it and use your device print dialog.',
  ]);
}

/** Filename: name-YYYY-MM-DD-HHmmss.pdf */
export function payslipDownloadName(workerName: string, when = new Date()): string {
  const name =
    workerName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'worker';
  const y = when.getFullYear();
  const mo = String(when.getMonth() + 1).padStart(2, '0');
  const d = String(when.getDate()).padStart(2, '0');
  const h = String(when.getHours()).padStart(2, '0');
  const mi = String(when.getMinutes()).padStart(2, '0');
  const s = String(when.getSeconds()).padStart(2, '0');
  return `${name}-${y}-${mo}-${d}-${h}${mi}${s}.pdf`;
}

export function peso(n: number): string {
  return `PHP ${n.toFixed(2)}`;
}
