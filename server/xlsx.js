// A small Excel (.xlsx) writer for the task-upload template: one visible sheet with headings, an example row and
// dropdown lists (data validation), plus a hidden "Lists" sheet holding the values. No dependencies:
// an .xlsx file is a zip of XML parts, written here with node:zlib.
import { deflateRawSync, crc32 } from 'node:zlib';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const colName = (i) => { let s = ''; for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };

// ---------- zip ----------
function zip(files) {
  const chunks = []; const central = []; let offset = 0;
  for (const [name, text] of files) {
    const data = Buffer.from(text, 'utf8');
    const comp = deflateRawSync(data);
    const crc = crc32(data) >>> 0;
    const nameBuf = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(0, 10); local.writeUInt32LE(crc, 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, comp);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10);
    c.writeUInt32LE(0, 12); c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(nameBuf.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, nameBuf);
    offset += local.length + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, cd, end]);
}

// ---------- workbook ----------
// columns: [{ title, width, list?: string[], strict?: boolean, note?: string }]; example: one row of values.
export function templateXlsx({ columns, example = [], rows = 1000, listsSheet = 'Lists' }) {
  // shared strings (read by every spreadsheet program and by the upload reader)
  const strings = []; const index = new Map();
  const si = (s) => { s = String(s); if (!index.has(s)) { index.set(s, strings.length); strings.push(s); } return index.get(s); };
  const cellXml = (ref, v, style) => (v === '' || v == null ? (style ? `<c r="${ref}" s="${style}"/>` : '')
    : typeof v === 'number' ? `<c r="${ref}"${style ? ` s="${style}"` : ''}><v>${v}</v></c>`
      : `<c r="${ref}" t="s"${style ? ` s="${style}"` : ''}><v>${si(v)}</v></c>`);

  // hidden sheet: one column per list
  const listed = columns.map((c, i) => ({ ...c, i })).filter(c => c.list && c.list.length);
  const maxLen = Math.max(0, ...listed.map(c => c.list.length));
  let listRows = `<row r="1">${listed.map((c, j) => cellXml(`${colName(j)}1`, c.title, 1)).join('')}</row>`;
  for (let r = 0; r < maxLen; r++) listRows += `<row r="${r + 2}">${listed.map((c, j) => cellXml(`${colName(j)}${r + 2}`, c.list[r] ?? '')).join('')}</row>`;
  const sheet2 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${listRows}</sheetData></worksheet>`;

  // main sheet
  const head = `<row r="1">${columns.map((c, i) => cellXml(`${colName(i)}1`, c.title, 1)).join('')}</row>`;
  const ex = example.length ? `<row r="2">${columns.map((c, i) => cellXml(`${colName(i)}2`, example[i] ?? '')).join('')}</row>` : '';
  const last = rows + 1;
  const validations = listed.map((c, j) => {
    const L = colName(j);
    const range = `'${listsSheet}'!$${L}$2:$${L}$${c.list.length + 1}`;
    // strict lists refuse other values; the others suggest values but accept anything typed
    const strict = c.strict !== false;
    return `<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="${strict ? 1 : 0}"${strict ? '' : ' errorStyle="information"'}`
      + ` errorTitle="${esc(c.title)}" error="${esc(`Choose a value from the list for ${c.title}.`)}" promptTitle="${esc(c.title)}" prompt="${esc(c.note || `Choose from the list`)}"`
      + ` sqref="${colName(c.i)}2:${colName(c.i)}${last}"><formula1>${esc(range)}</formula1></dataValidation>`;
  }).join('');
  const notes = columns.map((c, i) => ({ ...c, i })).filter(c => !c.list && c.note);
  const prompts = notes.map(c => `<dataValidation type="none" allowBlank="1" showInputMessage="1" promptTitle="${esc(c.title)}" prompt="${esc(c.note)}" sqref="${colName(c.i)}2:${colName(c.i)}${last}"/>`).join('');
  const count = listed.length + notes.length;
  const sheet1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0" tabSelected="1"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width || 16}" customWidth="1"/>`).join('')}</cols>
<sheetData>${head}${ex}</sheetData>
<autoFilter ref="A1:${colName(columns.length - 1)}1"/>
${count ? `<dataValidations count="${count}">${validations}${prompts}</dataValidations>` : ''}
</worksheet>`;

  // (the sheets above are built first, so every shared string is known here)
  const sst = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${strings.map(s => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join('')}</sst>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0B3A7A"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<bookViews><workbookView activeTab="0"/></bookViews>
<sheets><sheet name="Tasks" sheetId="1" r:id="rId1"/><sheet name="${esc(listsSheet)}" sheetId="2" state="hidden" r:id="rId2"/></sheets>
<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">Tasks!$A$1:$${colName(columns.length - 1)}$1</definedName></definedNames>
</workbook>`;
  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
  const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>`;
  return zip([
    ['[Content_Types].xml', types], ['_rels/.rels', rels], ['xl/workbook.xml', workbook], ['xl/_rels/workbook.xml.rels', wbRels],
    ['xl/styles.xml', styles], ['xl/worksheets/sheet1.xml', sheet1], ['xl/worksheets/sheet2.xml', sheet2],
    ['xl/sharedStrings.xml', sst],
  ]);
}
