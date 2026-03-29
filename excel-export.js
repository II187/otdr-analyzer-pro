/**
 * OTDR Analyzer Pro – Excel Export
 * 
 * Erstellt eine professionelle .xlsx-Datei im Format der
 * LWL-Techniker Schweiz GmbH Messdokumentation.
 * 
 * Sheets:
 *   1. "Plan"      – Planungswerte / Grenzwerte (statische Vorlage)
 *   2. "Mittelwert" – Hauptergebnistabelle (1 Zeile pro Faser/Wellenlänge)
 *   3. "OE"        – Einzelmessungen A→B
 *   4. "EO"        – Einzelmessungen B→A
 */

'use strict';

const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');

// ============================================================
// Farben & Stile
// ============================================================

const COLORS = {
  headerBg: '1F3864',       // Dunkelblau (Header)
  headerFg: 'FFFFFF',       // Weiß
  subHeaderBg: '2E75B6',    // Blau
  subHeaderFg: 'FFFFFF',
  altRow: 'DCE6F1',         // Hellblau (alternative Zeilen)
  okGreen: 'C6EFCE',        // Grün
  okGreenFg: '276221',
  nokRed: 'FFC7CE',         // Rot
  nokRedFg: '9C0006',
  warningOrange: 'FFEB9C',  // Orange
  warningFg: '9C5700',
  borderColor: 'BDD7EE',
  titleBg: 'F2F2F2',
  companyOrange: 'E8740A'   // LWL-Techniker Orange
};

/**
 * Standard-Zellstil für Daten
 */
function dataStyle(bold = false, align = 'center') {
  return {
    font: { name: 'Calibri', size: 10, bold },
    alignment: { horizontal: align, vertical: 'middle', wrapText: false },
    border: {
      top: { style: 'thin', color: { argb: COLORS.borderColor } },
      bottom: { style: 'thin', color: { argb: COLORS.borderColor } },
      left: { style: 'thin', color: { argb: COLORS.borderColor } },
      right: { style: 'thin', color: { argb: COLORS.borderColor } }
    }
  };
}

/**
 * Header-Zellstil
 */
function headerStyle(bgColor = COLORS.headerBg) {
  return {
    font: { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.headerFg } },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } },
    alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
    border: {
      top: { style: 'medium', color: { argb: '000000' } },
      bottom: { style: 'medium', color: { argb: '000000' } },
      left: { style: 'thin', color: { argb: '000000' } },
      right: { style: 'thin', color: { argb: '000000' } }
    }
  };
}

/**
 * Wendet Stil auf einen Zellenbereich an
 */
function applyRangeStyle(sheet, startRow, startCol, endRow, endCol, style) {
  for (let r = startRow; r <= endRow; r++) {
    for (let c = startCol; c <= endCol; c++) {
      const cell = sheet.getCell(r, c);
      if (style.font) cell.font = style.font;
      if (style.fill) cell.fill = style.fill;
      if (style.alignment) cell.alignment = style.alignment;
      if (style.border) cell.border = style.border;
    }
  }
}

/**
 * Setzt Zeilen-Hintergrundfarbe
 */
function colorRow(sheet, row, colCount, argbColor, fontColor = '000000') {
  for (let c = 1; c <= colCount; c++) {
    const cell = sheet.getCell(row, c);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argbColor } };
    if (fontColor && cell.font) {
      cell.font = { ...cell.font, color: { argb: fontColor } };
    }
  }
}

// ============================================================
// Logo einbetten
// ============================================================

/**
 * Fügt das LWL-Techniker-Logo oben links in ein Sheet ein
 * Gibt true zurück wenn erfolgreich
 */
async function addLogoToSheet(workbook, sheet, logoPath) {
  try {
    if (!fs.existsSync(logoPath)) return false;

    const imageId = workbook.addImage({
      filename: logoPath,
      extension: 'jpeg'
    });

    sheet.addImage(imageId, {
      tl: { col: 0, row: 0 },
      ext: { width: 180, height: 45 }
    });

    return true;
  } catch (err) {
    console.warn('Logo konnte nicht eingefügt werden:', err.message);
    return false;
  }
}

/**
 * Fügt Kopf- und Fußzeile hinzu
 */
function addHeaderFooter(sheet, projectName, date) {
  const dateStr = date || new Date().toLocaleDateString('de-CH');

  sheet.headerFooter = {
    oddHeader: `&L&G&C&"Calibri,Bold"&14 OTDR Messdokumentation&R${projectName}`,
    oddFooter: `&L LWL-Techniker Schweiz GmbH | www.lwl-techniker.ch &C Seite &P von &N &RDatum: ${dateStr}`,
    evenHeader: `&L&G&C&"Calibri,Bold"&14 OTDR Messdokumentation&R${projectName}`,
    evenFooter: `&L LWL-Techniker Schweiz GmbH | www.lwl-techniker.ch &C Seite &P von &N &RDatum: ${dateStr}`
  };
}

// ============================================================
// Sheet 1: Plan
// ============================================================

/**
 * Erstellt den Plan-Sheet (Planungswerte & Grenzwerte)
 */
async function buildPlanSheet(workbook, logoPath, projectInfo, limits) {
  const sheet = workbook.addWorksheet('Plan', {
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true }
  });

  // Logo
  await addLogoToSheet(workbook, sheet, logoPath);

  // Spaltenbreiten
  sheet.columns = [
    { width: 35 },
    { width: 20 },
    { width: 20 },
    { width: 20 },
    { width: 20 }
  ];

  // Logo-Zeile Platzhalter (Rows 1-3 für Logo)
  sheet.getRow(1).height = 40;
  sheet.getRow(2).height = 5;

  // Titel
  sheet.mergeCells('A3:E3');
  const titleCell = sheet.getCell('A3');
  titleCell.value = 'OTDR Messdokumentation – Planungswerte & Grenzwerte';
  titleCell.font = { name: 'Calibri', size: 14, bold: true, color: { argb: COLORS.headerBg } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.titleBg } };
  sheet.getRow(3).height = 28;

  // Projektinfo
  const infoData = [
    ['Kabelbezeichnung', projectInfo.cableId || '—'],
    ['Projekt', projectInfo.project || '—'],
    ['Standort A', projectInfo.locationA || '—'],
    ['Standort B', projectInfo.locationB || '—'],
    ['Anzahl Fasern', projectInfo.fiberCount || '—'],
    ['Messtechniker', projectInfo.technician || '—'],
    ['Messdatum', projectInfo.date || new Date().toLocaleDateString('de-CH')],
    ['OTDR Gerät', projectInfo.device || '—']
  ];

  let rowIdx = 5;
  for (const [label, value] of infoData) {
    sheet.getCell(rowIdx, 1).value = label;
    sheet.getCell(rowIdx, 1).font = { bold: true, name: 'Calibri', size: 10 };
    sheet.getCell(rowIdx, 2).value = value;
    sheet.getCell(rowIdx, 2).font = { name: 'Calibri', size: 10 };
    sheet.getRow(rowIdx).height = 18;
    rowIdx++;
  }

  rowIdx += 1;

  // Grenzwerte-Tabelle
  sheet.mergeCells(`A${rowIdx}:E${rowIdx}`);
  const gwTitle = sheet.getCell(rowIdx, 1);
  gwTitle.value = 'Grenzwerte (Grenzwert = maximaler zulässiger Gesamtverlust)';
  gwTitle.font = { name: 'Calibri', size: 11, bold: true, color: { argb: COLORS.headerFg } };
  gwTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.headerBg } };
  gwTitle.alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getRow(rowIdx).height = 22;
  rowIdx++;

  // Grenzwert-Header
  const gwHeaders = ['Parameter', '1310 nm', '1550 nm', 'Einheit', 'Bemerkung'];
  for (let c = 0; c < gwHeaders.length; c++) {
    const cell = sheet.getCell(rowIdx, c + 1);
    cell.value = gwHeaders[c];
    Object.assign(cell, headerStyle(COLORS.subHeaderBg));
  }
  sheet.getRow(rowIdx).height = 20;
  rowIdx++;

  // Grenzwert-Daten
  const gwData = [
    ['Grenzwert Gesamtverlust', limits.limit1310 || 1.04, limits.limit1550 || 0.67, 'dB', 'Max. zulässiger Gesamtverlust'],
    ['Planwert Dämpfung', limits.plan1310 || 0.36, limits.plan1550 || 0.22, 'dB/km', 'Faserdämpfung ohne Verbindungen'],
    ['Max. Schweißverlust', '—', '—', 'dB', 'IEC 61300: ≤ 0.3 dB'],
    ['Max. Steckerverlust', '—', '—', 'dB', 'IEC 61300: ≤ 0.5 dB'],
    ['Min. ORL', '—', '—', 'dB', 'IEC 61300: ≥ 30 dB']
  ];

  for (const [param, v1310, v1550, unit, remark] of gwData) {
    sheet.getCell(rowIdx, 1).value = param;
    sheet.getCell(rowIdx, 2).value = v1310;
    sheet.getCell(rowIdx, 3).value = v1550;
    sheet.getCell(rowIdx, 4).value = unit;
    sheet.getCell(rowIdx, 5).value = remark;
    for (let c = 1; c <= 5; c++) {
      Object.assign(sheet.getCell(rowIdx, c), dataStyle(false, c === 1 ? 'left' : 'center'));
    }
    sheet.getRow(rowIdx).height = 18;
    rowIdx++;
  }

  // Fußzeile
  addHeaderFooter(sheet, projectInfo.project || 'OTDR Messung', projectInfo.date);

  return sheet;
}

// ============================================================
// Sheet 2: Mittelwert
// ============================================================

/**
 * Erstellt den Mittelwert-Sheet
 * Spalten: Anfang-Ende | Ende-Anfang | Wellenlänge | Dämpfung AB [dB] | Dämpfung BA [dB] | Dämpfung Mittelwert [dB]
 */
async function buildMittelwertSheet(workbook, logoPath, fiberGroups, projectInfo, limits) {
  const sheet = workbook.addWorksheet('Mittelwert', {
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true }
  });

  await addLogoToSheet(workbook, sheet, logoPath);

  sheet.columns = [
    { width: 5 },   // Nr.
    { width: 22 },  // Anfang-Ende
    { width: 22 },  // Ende-Anfang
    { width: 14 },  // Wellenlänge
    { width: 18 },  // Dämpfung AB
    { width: 18 },  // Dämpfung BA
    { width: 20 },  // Mittelwert
    { width: 10 }   // Status
  ];

  sheet.getRow(1).height = 40;
  sheet.getRow(2).height = 5;

  // Titel
  sheet.mergeCells('A3:H3');
  const titleCell = sheet.getCell('A3');
  titleCell.value = `OTDR Messergebnisse – Mittelwerte | ${projectInfo.cableId || ''} | ${projectInfo.date || ''}`;
  titleCell.font = { name: 'Calibri', size: 13, bold: true, color: { argb: COLORS.headerBg } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.titleBg } };
  sheet.getRow(3).height = 26;

  let rowIdx = 5;

  // Header
  const headers = ['Nr.', 'Anfang → Ende', 'Ende → Anfang', 'Wellenlänge', 'Dämpfung A→B [dB]', 'Dämpfung B→A [dB]', 'Mittelwert [dB]', 'Status'];
  for (let c = 0; c < headers.length; c++) {
    const cell = sheet.getCell(rowIdx, c + 1);
    cell.value = headers[c];
    Object.assign(cell, headerStyle());
  }
  sheet.getRow(rowIdx).height = 22;
  rowIdx++;

  // Daten: sortiert nach Fasernummer + Wellenlänge
  const rows = [];
  for (const [key, group] of Object.entries(fiberGroups)) {
    for (const wl of [1310, 1550]) {
      const oe = group.measurements[`${wl}_OE`];
      const eo = group.measurements[`${wl}_EO`];
      if (!oe && !eo) continue;

      const damAB = oe ? (oe.totalLoss || null) : null;
      const damBA = eo ? (eo.totalLoss || null) : null;
      const avg = (damAB !== null && damBA !== null)
        ? (damAB + damBA) / 2
        : (damAB ?? damBA);

      const limit = wl === 1310 ? (limits.limit1310 || 1.04) : (limits.limit1550 || 0.67);
      const status = avg !== null ? (avg <= limit ? 'OK' : 'NOK') : '—';

      rows.push({
        fiberNumber: group.fiberNumber,
        locationA: group.locationA || projectInfo.locationA || '—',
        locationB: group.locationB || projectInfo.locationB || '—',
        wavelength: wl,
        damAB,
        damBA,
        avg,
        status
      });
    }
  }

  // Sortieren
  rows.sort((a, b) => a.fiberNumber - b.fiberNumber || a.wavelength - b.wavelength);

  let nr = 1;
  for (const row of rows) {
    const isAlt = nr % 2 === 0;
    const bgColor = isAlt ? COLORS.altRow : 'FFFFFF';

    const cells = [
      nr,
      row.locationA,
      row.locationB,
      `${row.wavelength} nm`,
      row.damAB !== null ? row.damAB : '—',
      row.damBA !== null ? row.damBA : '—',
      row.avg !== null ? row.avg : '—',
      row.status
    ];

    for (let c = 0; c < cells.length; c++) {
      const cell = sheet.getCell(rowIdx, c + 1);
      cell.value = cells[c];

      const align = c === 0 || c >= 3 ? 'center' : 'left';
      Object.assign(cell, dataStyle(false, align));
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };

      // Zahlenwerte formatieren
      if (c >= 4 && c <= 6 && typeof cells[c] === 'number') {
        cell.numFmt = '0.000';
        cell.value = cells[c];
      }

      // Status einfärben
      if (c === 7) {
        if (row.status === 'OK') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.okGreen } };
          cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.okGreenFg } };
        } else if (row.status === 'NOK') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.nokRed } };
          cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.nokRedFg } };
        }
      }

      // Mittelwert-Grenzwert-Warnung
      if (c === 6 && row.avg !== null) {
        const limit = row.wavelength === 1310 ? (limits.limit1310 || 1.04) : (limits.limit1550 || 0.67);
        if (row.avg > limit) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.nokRed } };
        }
      }
    }

    sheet.getRow(rowIdx).height = 16;
    rowIdx++;
    nr++;
  }

  // Zusammenfassung
  rowIdx++;
  sheet.mergeCells(`A${rowIdx}:C${rowIdx}`);
  sheet.getCell(rowIdx, 1).value = 'Zusammenfassung';
  sheet.getCell(rowIdx, 1).font = { bold: true, size: 11, name: 'Calibri' };

  rowIdx++;
  const okCount = rows.filter(r => r.status === 'OK').length;
  const nokCount = rows.filter(r => r.status === 'NOK').length;
  const totalCount = rows.length;

  const summaryRows = [
    [`Gesamt Messungen:`, totalCount],
    [`Messungen OK:`, okCount],
    [`Messungen NOK:`, nokCount],
  ];

  const avgAll = rows.filter(r => r.avg !== null).map(r => r.avg);
  if (avgAll.length > 0) {
    const globalAvg = avgAll.reduce((a, b) => a + b, 0) / avgAll.length;
    summaryRows.push(['Gesamtmittelwert:', globalAvg.toFixed(4) + ' dB']);
  }

  for (const [label, val] of summaryRows) {
    sheet.getCell(rowIdx, 1).value = label;
    sheet.getCell(rowIdx, 1).font = { bold: true, name: 'Calibri', size: 10 };
    sheet.getCell(rowIdx, 2).value = val;
    sheet.getCell(rowIdx, 2).font = { name: 'Calibri', size: 10 };
    rowIdx++;
  }

  addHeaderFooter(sheet, projectInfo.project || 'OTDR Messung', projectInfo.date);

  return sheet;
}

// ============================================================
// Sheet 3 & 4: OE / EO
// ============================================================

/**
 * Erstellt einen Messungsdaten-Sheet (OE oder EO)
 * 
 * Spalten: Nr | Dateiname | Faser | Wellenlänge (nm) | Gesamtverlust (OTDR) (dB) |
 *          ORL (dB) | Gesamte Länge (km) | Max Spleiss (dB) | Max Anschlüsse (dB) |
 *          Max Reflexion (dB) | Ereignisanzahl
 */
async function buildRawSheet(workbook, logoPath, sheetName, direction, fiberGroups, projectInfo, limits) {
  const sheet = workbook.addWorksheet(sheetName, {
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true }
  });

  await addLogoToSheet(workbook, sheet, logoPath);

  sheet.columns = [
    { width: 5 },   // Nr.
    { width: 35 },  // Dateiname
    { width: 8 },   // Faser
    { width: 14 },  // Wellenlänge
    { width: 20 },  // Gesamtverlust
    { width: 12 },  // ORL
    { width: 15 },  // Länge km
    { width: 15 },  // Max Spleiss
    { width: 16 },  // Max Anschlüsse
    { width: 16 },  // Max Reflexion
    { width: 14 }   // Ereignisanzahl
  ];

  sheet.getRow(1).height = 40;
  sheet.getRow(2).height = 5;

  const dirLabel = direction === 'OE' ? 'A→B' : 'B→A';
  sheet.mergeCells('A3:K3');
  const titleCell = sheet.getCell('A3');
  titleCell.value = `OTDR Rohdaten Richtung ${dirLabel} | ${projectInfo.cableId || ''} | ${projectInfo.date || ''}`;
  titleCell.font = { name: 'Calibri', size: 13, bold: true, color: { argb: COLORS.headerBg } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.titleBg } };
  sheet.getRow(3).height = 26;

  let rowIdx = 5;

  // Header
  const headers = [
    'Nr.', 'Dateiname', 'Faser', 'Wellenlänge (nm)',
    'Gesamtverlust (OTDR) [dB]', 'ORL [dB]', 'Gesamte Länge [km]',
    'Max Spleiss [dB]', 'Max Anschlüsse [dB]', 'Max Reflexion [dB]', 'Ereignisanzahl'
  ];

  for (let c = 0; c < headers.length; c++) {
    const cell = sheet.getCell(rowIdx, c + 1);
    cell.value = headers[c];
    Object.assign(cell, headerStyle());
  }
  sheet.getRow(rowIdx).height = 22;
  rowIdx++;

  // Daten sammeln
  const rows = [];
  for (const [key, group] of Object.entries(fiberGroups)) {
    for (const wl of [1310, 1550]) {
      const meas = group.measurements[`${wl}_${direction}`];
      if (!meas) continue;

      rows.push({
        fiberNumber: group.fiberNumber,
        filename: meas.filename || '—',
        wavelength: wl,
        totalLoss: meas.totalLoss || null,
        orl: meas.orl || null,
        lengthKm: meas.fiberLengthM ? meas.fiberLengthM / 1000 : null,
        maxSplice: meas.maxSpliceLoss || null,
        maxConnector: meas.maxConnectorLoss || null,
        maxReflection: meas.maxReflection || null,
        eventCount: meas.eventCount || 0
      });
    }
  }

  rows.sort((a, b) => a.fiberNumber - b.fiberNumber || a.wavelength - b.wavelength);

  let nr = 1;
  for (const row of rows) {
    const isAlt = nr % 2 === 0;
    const bgColor = isAlt ? COLORS.altRow : 'FFFFFF';

    const cells = [
      nr,
      row.filename,
      row.fiberNumber,
      row.wavelength,
      row.totalLoss,
      row.orl,
      row.lengthKm,
      row.maxSplice,
      row.maxConnector,
      row.maxReflection !== null ? Math.abs(row.maxReflection) : null,
      row.eventCount
    ];

    const limit = row.wavelength === 1310 ? (limits.limit1310 || 1.04) : (limits.limit1550 || 0.67);
    const isNok = row.totalLoss !== null && row.totalLoss > limit;

    for (let c = 0; c < cells.length; c++) {
      const cell = sheet.getCell(rowIdx, c + 1);
      cell.value = cells[c] !== null ? cells[c] : '—';

      const align = c <= 1 ? 'left' : 'center';
      Object.assign(cell, dataStyle(false, align));
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };

      // Zahlenwerte formatieren
      if (c >= 4 && c <= 9 && typeof cells[c] === 'number') {
        cell.numFmt = '0.000';
      }
      if (c === 6 && typeof cells[c] === 'number') {
        cell.numFmt = '0.000';
      }

      // NOK-Zeile einfärben
      if (isNok && c === 4) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.nokRed } };
        cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.nokRedFg } };
      }
    }

    sheet.getRow(rowIdx).height = 16;
    rowIdx++;
    nr++;
  }

  addHeaderFooter(sheet, projectInfo.project || 'OTDR Messung', projectInfo.date);

  return sheet;
}

// ============================================================
// Hauptfunktion
// ============================================================

/**
 * Erstellt die vollständige Excel-Datei.
 * 
 * @param {Object} params
 * @param {Object} params.fiberGroups    – Gruppierte Fasermessungen
 * @param {Object} params.projectInfo    – Projektinformationen
 * @param {Object} params.limits         – Grenzwerte
 * @param {string} params.logoPath       – Pfad zum Logo (logo.jpg)
 * @returns {Buffer} Excel-Datei als Buffer
 */
async function exportToExcel({ fiberGroups, projectInfo, limits, logoPath }) {
  const workbook = new ExcelJS.Workbook();

  // Workbook-Metadaten
  workbook.creator = 'OTDR Analyzer Pro – LWL-Techniker Schweiz GmbH';
  workbook.company = 'LWL-Techniker Schweiz GmbH';
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.lastModifiedBy = projectInfo.technician || 'OTDR Analyzer Pro';

  // Standarddatum für Projektinfo
  if (!projectInfo.date) {
    projectInfo.date = new Date().toLocaleDateString('de-CH');
  }

  // Logo-Pfad prüfen
  const resolvedLogo = logoPath && fs.existsSync(logoPath) ? logoPath : null;

  // Sheets erstellen
  await buildPlanSheet(workbook, resolvedLogo, projectInfo, limits);
  await buildMittelwertSheet(workbook, resolvedLogo, fiberGroups, projectInfo, limits);
  await buildRawSheet(workbook, resolvedLogo, 'OE', 'OE', fiberGroups, projectInfo, limits);
  await buildRawSheet(workbook, resolvedLogo, 'EO', 'EO', fiberGroups, projectInfo, limits);

  // Als Buffer zurückgeben
  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
}

module.exports = { exportToExcel };
