/**
 * OTDR Analyzer Pro – Renderer Prozess
 * 
 * Vollständige UI-Logik:
 * - Datei-Import und asynchrones Parsing mit Progress-Bar
 * - Faser-Gruppierung und Auswertung
 * - Chart-Darstellung (Chart.js)
 * - Events-Tabelle
 * - Excel-Export
 * - Einstellungen / Grenzwerte
 * 
 * Alle SOR-Daten werden lazy geladen: Trace-Daten erst beim Auswählen.
 */

'use strict';

// ============================================================
// Globaler Zustand
// ============================================================

const STATE = {
  // Alle geladenen Dateien { path, filename, parsed (meta+events, kein trace), fiberNumber, wavelength, direction }
  files: [],

  // Gruppiert nach fiberNumber → { fiberNumber, locationA, locationB, measurements: { "1310_OE": {...}, ... } }
  fiberGroups: {},

  // Aktuell ausgewählte Faser
  selectedFiber: null,

  // Toggle: welche Wellenlängen/Richtungen im Chart sichtbar
  show1310: true,
  show1550: true,
  showOE: true,
  showEO: true,

  // Einstellungen / Grenzwerte
  settings: {
    limit1310: 1.04,
    limit1550: 0.67,
    plan1310: 0.36,
    plan1550: 0.22,
    cableId: '',
    project: '',
    locationA: '',
    locationB: '',
    technician: '',
    date: new Date().toISOString().split('T')[0]
  },

  // Chart-Instanz
  chart: null,

  // Trace-Cache (fiberNumber → { "1310_OE": points[], "1550_OE": points[], ... })
  traceCache: new Map()
};

// ============================================================
// Initialisierung
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {
  // App-Version anzeigen
  try {
    const version = await window.electronAPI.getVersion();
    document.getElementById('status-version').textContent = `v${version}`;
  } catch { /* ignore */ }

  // Gespeicherte Einstellungen laden
  loadSettingsFromStorage();

  // Event-Listener für Menü-Kommandos
  window.electronAPI.onFilesOpened(data => handleFilesReceived(data));
  window.electronAPI.onMenuExportExcel(() => handleExportExcel());
  window.electronAPI.onMenuExportAll(() => handleExportAll());

  // Chart initialisieren
  initChart();

  // Bottom Panel Resize
  initBottomResize();

  setStatus('Bereit. Ordner öffnen oder Dateien auswählen.');

  // Button Event Listeners (contextIsolation fix - onclick in HTML doesn't work)
  const btnFolder = document.getElementById('btn-open-folder');
  const btnFiles = document.getElementById('btn-open-files');
  const btnExport = document.getElementById('btn-export');
  const btnExportAll = document.getElementById('btn-export-all');
  const btnClear = document.getElementById('btn-clear');

  if (btnFolder) btnFolder.addEventListener('click', () => handleOpenFolder());
  if (btnFiles) btnFiles.addEventListener('click', () => handleOpenFiles());
  if (btnExport) btnExport.addEventListener('click', () => handleExportExcel());
  if (btnExportAll) btnExportAll.addEventListener('click', () => handleExportAll());
  if (btnClear) btnClear.addEventListener('click', () => handleClear());
});

// ============================================================
// Einstellungen
// ============================================================

function loadSettingsFromStorage() {
  try {
    const raw = localStorage.getItem('otdr-settings');
    if (raw) {
      const saved = JSON.parse(raw);
      Object.assign(STATE.settings, saved);
    }
  } catch { /* ignore */ }
}

function saveSettingsToStorage() {
  localStorage.setItem('otdr-settings', JSON.stringify(STATE.settings));
}

function openSettings() {
  const s = STATE.settings;
  document.getElementById('set-limit-1310').value = s.limit1310;
  document.getElementById('set-limit-1550').value = s.limit1550;
  document.getElementById('set-plan-1310').value = s.plan1310;
  document.getElementById('set-plan-1550').value = s.plan1550;
  document.getElementById('set-cable-id').value = s.cableId || '';
  document.getElementById('set-project').value = s.project || '';
  document.getElementById('set-loca').value = s.locationA || '';
  document.getElementById('set-locb').value = s.locationB || '';
  document.getElementById('set-tech').value = s.technician || '';
  document.getElementById('set-date').value = s.date || new Date().toISOString().split('T')[0];

  document.getElementById('settings-overlay').classList.add('visible');
}

function closeSettings() {
  document.getElementById('settings-overlay').classList.remove('visible');
}

function saveSettings() {
  const s = STATE.settings;

  s.limit1310 = parseFloat(document.getElementById('set-limit-1310').value) || 1.04;
  s.limit1550 = parseFloat(document.getElementById('set-limit-1550').value) || 0.67;
  s.plan1310 = parseFloat(document.getElementById('set-plan-1310').value) || 0.36;
  s.plan1550 = parseFloat(document.getElementById('set-plan-1550').value) || 0.22;
  s.cableId = document.getElementById('set-cable-id').value.trim();
  s.project = document.getElementById('set-project').value.trim();
  s.locationA = document.getElementById('set-loca').value.trim();
  s.locationB = document.getElementById('set-locb').value.trim();
  s.technician = document.getElementById('set-tech').value.trim();
  s.date = document.getElementById('set-date').value;

  saveSettingsToStorage();
  closeSettings();

  // UI aktualisieren
  updateTopBarInfo();

  // Falls Dateien geladen: Auswertung neu berechnen
  if (STATE.files.length > 0) {
    evaluateAll();
    renderFiberList();
    updateSummaryBadges();
  }

  setStatus('Einstellungen gespeichert.');
}

// ============================================================
// Datei-Import
// ============================================================

async function handleOpenFolder() {
  await window.electronAPI.openFolder();
}

async function handleOpenFiles() {
  await window.electronAPI.openFiles();
}

async function handleFilesReceived({ files, folder }) {
  if (!files || files.length === 0) return;

  setStatus(`Lade ${files.length} Dateien...`);
  showProgress(true);

  // Bestehende Daten löschen (Neustart)
  STATE.files = [];
  STATE.fiberGroups = {};
  STATE.traceCache.clear();

  const total = files.length;
  let processed = 0;
  let errors = 0;

  updateProgress(0, total, 'Dateien werden analysiert...');

  // Batch-Verarbeitung: 10 Dateien gleichzeitig für Performance
  const BATCH_SIZE = 10;

  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE);

    // Batch parallel verarbeiten
    const batchResults = await Promise.all(
      batch.map(filePath => parseSingleFile(filePath))
    );

    for (const result of batchResults) {
      if (result) {
        STATE.files.push(result);
      } else {
        errors++;
      }
      processed++;
    }

    updateProgress(processed, total, batch[0].split(/[/\\]/).pop() + '...');

    // UI nicht einfrieren: kurze Pause
    await sleep(1);
  }

  hideProgress();

  if (STATE.files.length === 0) {
    setStatus(`Fehler: Keine gültigen SOR-Dateien gefunden (${errors} Fehler).`);
    return;
  }

  // Fasern gruppieren und auswerten
  groupFiles();
  evaluateAll();
  renderFiberList();
  updateTopBarInfo();
  updateSummaryBadges();
  enableButtons();

  const fiberCount = Object.keys(STATE.fiberGroups).length;
  setStatus(`✓ ${STATE.files.length} Dateien geladen | ${fiberCount} Fasern | ${errors > 0 ? `${errors} Fehler` : 'Keine Fehler'}`);
}

/**
 * Parst eine einzelne SOR-Datei (ohne Trace-Daten für Performance)
 */
async function parseSingleFile(filePath) {
  try {
    const result = await window.electronAPI.readFile(filePath);
    if (!result.success) return null;

    // ArrayBuffer → Buffer (Node.js Buffer ist im Renderer via Electron verfügbar)
    const buf = Buffer.from(result.data);
    const filename = filePath.split(/[/\\]/).pop();

    // SOR parsen (ohne Trace für schnelles Laden)
    const parsed = window.sorParser.parseSorFile(buf, false);

    // Dateiname-Metadaten
    const filenameInfo = window.sorParser.parseFilename(filename);

    // Wellenlänge aus Datei bevorzugen, dann Dateiname
    const wavelength = parsed.measurements.wavelengthNm ||
      filenameInfo.wavelength ||
      (parsed.meta.nominalWavelength ? Math.round(parsed.meta.nominalWavelength) : 0) ||
      1310;

    // Wellenlänge normalisieren
    const wlNorm = wavelength >= 1540 ? 1550 : 1310;

    return {
      path: filePath,
      filename,
      fiberNumber: filenameInfo.fiberNumber || 1,
      wavelength: wlNorm,
      direction: filenameInfo.direction || 'OE',
      cableId: filenameInfo.cableId,
      // Messdaten (ohne Trace)
      totalLoss: parsed.measurements.totalLoss || null,
      orl: parsed.measurements.orl || null,
      fiberLengthM: parsed.measurements.fiberLengthM || null,
      avgLossPerKm: parsed.measurements.avgLossPerKm || null,
      maxSpliceLoss: parsed.measurements.maxSpliceLoss || null,
      maxConnectorLoss: parsed.measurements.maxConnectorLoss || null,
      maxReflection: parsed.measurements.maxReflection || null,
      eventCount: parsed.measurements.eventCount || 0,
      spliceCount: parsed.measurements.spliceCount || 0,
      connectorCount: parsed.measurements.connectorCount || 0,
      events: parsed.events || [],
      // Meta
      locationA: parsed.meta.locationA || '',
      locationB: parsed.meta.locationB || '',
      operator: parsed.meta.operator || '',
      cableIdFromFile: parsed.meta.cableId || '',
      measurementDate: parsed.meta.measurementDate || null,
      device: `${parsed.meta.supplier || ''} ${parsed.meta.otdrName || ''}`.trim(),
      // Rohdaten-Ref
      parseErrors: parsed.parseErrors || []
    };
  } catch (err) {
    console.error(`Fehler beim Parsen von ${filePath}:`, err);
    return null;
  }
}

/**
 * Lädt Trace-Daten für eine Datei (lazy loading)
 */
async function loadTraceData(filePath) {
  try {
    const result = await window.electronAPI.readFile(filePath);
    if (!result.success) return null;

    const buf = Buffer.from(result.data); // ArrayBuffer → Node Buffer
    const parsed = window.sorParser.parseSorFile(buf, true);

    if (!parsed.traceData || parsed.traceData.numPoints === 0) return null;

    return parsed.traceData;
  } catch (err) {
    console.error('Fehler beim Laden der Trace-Daten:', err);
    return null;
  }
}

// ============================================================
// Faser-Gruppierung
// ============================================================

function groupFiles() {
  STATE.fiberGroups = {};

  for (const file of STATE.files) {
    const key = file.fiberNumber;

    if (!STATE.fiberGroups[key]) {
      STATE.fiberGroups[key] = {
        fiberNumber: key,
        locationA: '',
        locationB: '',
        operator: '',
        device: '',
        measurements: {},
        status: null // wird in evaluateAll() gesetzt
      };
    }

    const group = STATE.fiberGroups[key];

    // Metadaten aus erster verfügbarer Datei
    if (!group.locationA && file.locationA) group.locationA = file.locationA;
    if (!group.locationB && file.locationB) group.locationB = file.locationB;
    if (!group.operator && file.operator) group.operator = file.operator;
    if (!group.device && file.device) group.device = file.device;

    // Messung speichern: Key = "1310_OE", "1550_EO", etc.
    const measKey = `${file.wavelength}_${file.direction}`;
    group.measurements[measKey] = file;
  }
}

// ============================================================
// Auswertung (OK/NOK)
// ============================================================

function evaluateAll() {
  const s = STATE.settings;

  for (const [, group] of Object.entries(STATE.fiberGroups)) {
    let hasNok = false;
    let hasAny = false;

    for (const wl of [1310, 1550]) {
      const oe = group.measurements[`${wl}_OE`];
      const eo = group.measurements[`${wl}_EO`];

      if (!oe && !eo) continue;
      hasAny = true;

      const damAB = oe?.totalLoss ?? null;
      const damBA = eo?.totalLoss ?? null;
      const avg = (damAB !== null && damBA !== null)
        ? (damAB + damBA) / 2
        : (damAB ?? damBA);

      const limit = wl === 1310 ? s.limit1310 : s.limit1550;

      if (avg !== null && avg > limit) {
        hasNok = true;
      }
    }

    group.status = hasAny ? (hasNok ? 'NOK' : 'OK') : 'unknown';
  }
}

// ============================================================
// Faserliste rendern
// ============================================================

function renderFiberList(filter = '') {
  const list = document.getElementById('fiber-list');
  const emptyState = document.getElementById('sidebar-empty-state');
  const countLabel = document.getElementById('fiber-count-label');

  const groups = Object.values(STATE.fiberGroups)
    .sort((a, b) => a.fiberNumber - b.fiberNumber);

  const filtered = filter
    ? groups.filter(g => String(g.fiberNumber).includes(filter) ||
        (g.locationA || '').toLowerCase().includes(filter.toLowerCase()) ||
        (g.locationB || '').toLowerCase().includes(filter.toLowerCase()))
    : groups;

  // Alte Einträge entfernen (außer Empty State)
  const items = list.querySelectorAll('.fiber-item');
  items.forEach(el => el.remove());

  if (filtered.length === 0) {
    emptyState.style.display = '';
    countLabel.textContent = '';
    return;
  }

  emptyState.style.display = 'none';
  countLabel.textContent = `${filtered.length} Fasern`;

  for (const group of filtered) {
    const item = document.createElement('div');
    item.className = `fiber-item ${group.status || ''}`;
    item.dataset.fiber = group.fiberNumber;

    if (STATE.selectedFiber === group.fiberNumber) {
      item.classList.add('active');
    }

    // Verfügbare Wellenlängen
    const wlBadges = [1310, 1550]
      .filter(wl => group.measurements[`${wl}_OE`] || group.measurements[`${wl}_EO`])
      .map(wl => `<span class="wl-badge nm${wl}">${wl}</span>`)
      .join('');

    // Verlustanzeige
    let lossInfo = '';
    for (const wl of [1310, 1550]) {
      const oe = group.measurements[`${wl}_OE`];
      const eo = group.measurements[`${wl}_EO`];
      if (!oe && !eo) continue;
      const damAB = oe?.totalLoss;
      const damBA = eo?.totalLoss;
      const avg = (damAB != null && damBA != null)
        ? ((damAB + damBA) / 2).toFixed(3)
        : (damAB ?? damBA)?.toFixed(3);
      if (avg != null) lossInfo += `${wl}nm: ${avg}dB `;
    }

    item.innerHTML = `
      <div class="fiber-status-dot"></div>
      <div class="fiber-info">
        <div class="fiber-name">Faser ${String(group.fiberNumber).padStart(3, '0')}</div>
        <div class="fiber-detail">${lossInfo || (group.locationA ? `${group.locationA} → ${group.locationB}` : 'Keine Daten')}</div>
      </div>
      <div class="fiber-wl-badges">${wlBadges}</div>
    `;

    item.addEventListener('click', () => selectFiber(group.fiberNumber));
    list.appendChild(item);
  }
}

function filterFibers(value) {
  renderFiberList(value.trim());
}

// ============================================================
// Faser auswählen & Chart laden
// ============================================================

async function selectFiber(fiberNumber) {
  STATE.selectedFiber = fiberNumber;

  // Sidebar-Auswahl aktualisieren
  document.querySelectorAll('.fiber-item').forEach(el => {
    el.classList.toggle('active', parseInt(el.dataset.fiber) === fiberNumber);
  });

  const group = STATE.fiberGroups[fiberNumber];
  if (!group) return;

  // Chart-Titel
  document.getElementById('chart-title').textContent =
    `Faser ${String(fiberNumber).padStart(3, '0')} – ${group.locationA || '?'} → ${group.locationB || '?'}`;

  // Messinfo-Cards
  renderMeasCards(group);

  // Events-Tabelle
  renderEventsTable(group);

  // Trace-Daten laden (lazy)
  setStatus(`Lade Tracedaten für Faser ${fiberNumber}...`);
  await loadAndRenderTraces(fiberNumber, group);
  setStatus(`Faser ${String(fiberNumber).padStart(3, '0')} geladen.`);
}

// ============================================================
// Messinfo-Cards
// ============================================================

function renderMeasCards(group) {
  const container = document.getElementById('meas-info');
  container.innerHTML = '';

  const s = STATE.settings;

  for (const wl of [1310, 1550]) {
    const oe = group.measurements[`${wl}_OE`];
    const eo = group.measurements[`${wl}_EO`];
    if (!oe && !eo) continue;

    const damAB = oe?.totalLoss ?? null;
    const damBA = eo?.totalLoss ?? null;
    const avg = (damAB !== null && damBA !== null)
      ? (damAB + damBA) / 2
      : (damAB ?? damBA);

    const limit = wl === 1310 ? s.limit1310 : s.limit1550;
    const isNok = avg !== null && avg > limit;

    const lengthM = oe?.fiberLengthM || eo?.fiberLengthM;
    const orl = oe?.orl || eo?.orl;

    const cards = [
      { label: `Mittelwert ${wl}nm`, value: avg?.toFixed(3) ?? '—', unit: 'dB', status: isNok ? 'nok' : 'ok' },
      ...(damAB !== null ? [{ label: `A→B ${wl}nm`, value: damAB.toFixed(3), unit: 'dB' }] : []),
      ...(damBA !== null ? [{ label: `B→A ${wl}nm`, value: damBA.toFixed(3), unit: 'dB' }] : []),
      ...(lengthM ? [{ label: 'Länge', value: (lengthM / 1000).toFixed(3), unit: 'km' }] : []),
      ...(orl ? [{ label: 'ORL', value: orl.toFixed(1), unit: 'dB' }] : [])
    ];

    for (const card of cards) {
      const div = document.createElement('div');
      div.className = 'meas-card';
      div.innerHTML = `
        <div class="mc-label">${card.label}</div>
        <div class="mc-value ${card.status || ''}">${card.value}<span class="mc-unit">${card.unit}</span></div>
      `;
      container.appendChild(div);
    }
  }
}

// ============================================================
// Trace Chart
// ============================================================

function initChart() {
  const canvas = document.getElementById('main-chart');
  const ctx = canvas.getContext('2d');

  STATE.chart = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: []
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 200 },
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: {
            color: '#9fa8c0',
            font: { family: "'Segoe UI', sans-serif", size: 11 },
            boxWidth: 16,
            padding: 12,
            usePointStyle: true,
            pointStyle: 'line'
          }
        },
        tooltip: {
          backgroundColor: '#1c2030',
          borderColor: '#2e3560',
          borderWidth: 1,
          titleColor: '#e8eaf6',
          bodyColor: '#9fa8c0',
          callbacks: {
            title: (items) => `${(items[0].parsed.x / 1000).toFixed(3)} km`,
            label: (item) => ` ${item.dataset.label}: ${item.parsed.y.toFixed(3)} dB`
          }
        },
        zoom: {
          zoom: {
            wheel: { enabled: true },
            pinch: { enabled: true },
            mode: 'xy'
          },
          pan: {
            enabled: true,
            mode: 'xy'
          }
        }
      },
      scales: {
        x: {
          type: 'linear',
          title: {
            display: true,
            text: 'Entfernung (m)',
            color: '#5c6380',
            font: { size: 11 }
          },
          ticks: {
            color: '#5c6380',
            font: { size: 10 },
            callback: (val) => `${val >= 1000 ? (val/1000).toFixed(1) + 'km' : val + 'm'}`
          },
          grid: {
            color: 'rgba(255,255,255,0.04)'
          }
        },
        y: {
          title: {
            display: true,
            text: 'Pegel (dB)',
            color: '#5c6380',
            font: { size: 11 }
          },
          ticks: {
            color: '#5c6380',
            font: { size: 10 },
            callback: (val) => `${val.toFixed(1)} dB`
          },
          grid: {
            color: 'rgba(255,255,255,0.04)'
          }
        }
      }
    }
  });
}

async function loadAndRenderTraces(fiberNumber, group) {
  const chartEmpty = document.getElementById('chart-empty');
  chartEmpty.style.display = 'none';

  // Aus Cache laden falls vorhanden
  let traces = STATE.traceCache.get(fiberNumber);

  if (!traces) {
    traces = {};

    // Alle verfügbaren Traces laden
    for (const wl of [1310, 1550]) {
      for (const dir of ['OE', 'EO']) {
        const meas = group.measurements[`${wl}_${dir}`];
        if (!meas) continue;

        const traceData = await loadTraceData(meas.path);
        if (!traceData) continue;

        // Trace normalisieren
        const isReverse = dir === 'EO';
        const points = window.sorParser.normalizeTrace(
          traceData.points,
          traceData.spacingM,
          isReverse
        );

        traces[`${wl}_${dir}`] = {
          points,
          spacingM: traceData.spacingM
        };
      }
    }

    STATE.traceCache.set(fiberNumber, traces);
  }

  // Chart aktualisieren
  renderChart(traces, group);
}

function renderChart(traces, group) {
  const datasets = [];

  const config = {
    '1310_OE': { color: '#2196F3', label: '1310 nm A→B', wl: 1310 },
    '1310_EO': { color: '#64B5F6', label: '1310 nm B→A', wl: 1310, dash: [5, 3] },
    '1550_OE': { color: '#9C27B0', label: '1550 nm A→B', wl: 1550 },
    '1550_EO': { color: '#CE93D8', label: '1550 nm B→A', wl: 1550, dash: [5, 3] }
  };

  for (const [key, cfg] of Object.entries(config)) {
    const trace = traces[key];
    if (!trace) continue;

    const wl = cfg.wl;
    const isOE = key.endsWith('OE');
    const isEO = key.endsWith('EO');

    // Toggle-Filter
    if (wl === 1310 && !STATE.show1310) continue;
    if (wl === 1550 && !STATE.show1550) continue;
    if (isOE && !STATE.showOE) continue;
    if (isEO && !STATE.showEO) continue;

    datasets.push({
      label: cfg.label,
      data: trace.points,
      borderColor: cfg.color,
      backgroundColor: 'transparent',
      borderWidth: 1.5,
      pointRadius: 0,
      pointHoverRadius: 3,
      tension: 0,
      borderDash: cfg.dash || [],
      parsing: { xAxisKey: 'x', yAxisKey: 'y' }
    });
  }

  STATE.chart.data.datasets = datasets;
  STATE.chart.update('none');

  const chartEmpty = document.getElementById('chart-empty');
  chartEmpty.style.display = datasets.length === 0 ? '' : 'none';
}

function toggleWavelength(wl) {
  if (wl === 1310) {
    STATE.show1310 = !STATE.show1310;
    const chip = document.getElementById('toggle-1310');
    chip.classList.toggle('active-1310', STATE.show1310);
  } else {
    STATE.show1550 = !STATE.show1550;
    const chip = document.getElementById('toggle-1550');
    chip.classList.toggle('active-1550', STATE.show1550);
  }

  // Chart neu rendern falls Faser ausgewählt
  if (STATE.selectedFiber !== null) {
    const group = STATE.fiberGroups[STATE.selectedFiber];
    const traces = STATE.traceCache.get(STATE.selectedFiber);
    if (traces && group) renderChart(traces, group);
  }
}

function resetZoom() {
  if (STATE.chart) {
    STATE.chart.resetZoom();
  }
}

// ============================================================
// Events-Tabelle
// ============================================================

function renderEventsTable(group) {
  const tbody = document.getElementById('events-tbody');
  const countLabel = document.getElementById('events-count-label');
  tbody.innerHTML = '';

  const allEvents = [];

  for (const wl of [1310, 1550]) {
    for (const dir of ['OE', 'EO']) {
      const meas = group.measurements[`${wl}_${dir}`];
      if (!meas || !meas.events) continue;

      for (const evt of meas.events) {
        allEvents.push({ ...evt, wavelength: wl, direction: dir });
      }
    }
  }

  countLabel.textContent = `${allEvents.length} Ereignisse`;

  if (allEvents.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:var(--text-muted);padding:20px;">Keine Ereignisse</td></tr>`;
    return;
  }

  // Sortieren: Wellenlänge, Richtung, Position
  allEvents.sort((a, b) => a.wavelength - b.wavelength || a.direction.localeCompare(b.direction) || a.distanceM - b.distanceM);

  for (const evt of allEvents) {
    const dirLabel = evt.direction === 'OE' ? 'A→B' : 'B→A';
    const dirColor = evt.direction === 'OE' ? 'var(--accent)' : 'var(--accent-red)';
    const typeClass = getEventTypeClass(evt.type);

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${evt.eventNumber || '—'}</td>
      <td><span style="color:${dirColor};font-weight:600">${dirLabel}</span></td>
      <td>${evt.wavelength} nm</td>
      <td>${evt.distanceM != null ? evt.distanceM.toFixed(1) : '—'}</td>
      <td style="text-align:left"><span class="${typeClass}">${evt.type || '—'}</span></td>
      <td>${evt.spliceLoss != null ? evt.spliceLoss.toFixed(3) : '—'}</td>
      <td>${evt.reflectionLoss != null ? evt.reflectionLoss.toFixed(1) : '—'}</td>
      <td>${evt.slopeBefore != null ? evt.slopeBefore.toFixed(3) : '—'}</td>
      <td style="text-align:left;color:var(--text-muted);font-size:11px">${evt.comment || ''}</td>
    `;
    tbody.appendChild(tr);
  }
}

function getEventTypeClass(type) {
  if (!type) return '';
  const t = type.toLowerCase();
  if (t.includes('schweißung')) return 'event-type-splice';
  if (t.includes('stecker')) return 'event-type-connector';
  if (t.includes('reflexion')) return 'event-type-reflection';
  if (t.includes('ende')) return 'event-type-end';
  return '';
}

// ============================================================
// Top Bar Info
// ============================================================

function updateTopBarInfo() {
  const s = STATE.settings;
  const fiberCount = Object.keys(STATE.fiberGroups).length;

  // Projektinfo aus erster Datei oder Einstellungen
  let cableId = s.cableId;
  let locationA = s.locationA;
  let locationB = s.locationB;
  let technician = s.technician;
  let date = s.date;

  if (!cableId && STATE.files.length > 0) {
    cableId = STATE.files[0].cableId || STATE.files[0].cableIdFromFile || '';
  }
  if (!locationA && STATE.files.length > 0) {
    locationA = STATE.files.find(f => f.locationA)?.locationA || '';
  }
  if (!locationB && STATE.files.length > 0) {
    locationB = STATE.files.find(f => f.locationB)?.locationB || '';
  }
  if (!technician && STATE.files.length > 0) {
    technician = STATE.files.find(f => f.operator)?.operator || '';
  }
  if (!date && STATE.files.length > 0) {
    const d = STATE.files.find(f => f.measurementDate)?.measurementDate;
    if (d) date = new Date(d).toLocaleDateString('de-CH');
  }

  document.getElementById('info-cable').textContent = cableId || '—';
  document.getElementById('info-fibers').textContent = fiberCount || '—';
  document.getElementById('info-loca').textContent = locationA || '—';
  document.getElementById('info-locb').textContent = locationB || '—';
  document.getElementById('info-tech').textContent = technician || '—';
  document.getElementById('info-date').textContent = date || '—';

  // Statusbar
  document.getElementById('status-file-count').textContent = `${STATE.files.length} Dateien`;
}

// ============================================================
// Summary Badges
// ============================================================

function updateSummaryBadges() {
  const groups = Object.values(STATE.fiberGroups);
  const total = groups.length;
  const ok = groups.filter(g => g.status === 'OK').length;
  const nok = groups.filter(g => g.status === 'NOK').length;

  document.getElementById('total-count').textContent = total;
  document.getElementById('ok-count').textContent = ok;
  document.getElementById('nok-count').textContent = nok;

  document.getElementById('badge-total').style.display = total > 0 ? '' : 'none';
  document.getElementById('badge-ok').style.display = ok > 0 ? '' : 'none';
  document.getElementById('badge-nok').style.display = nok > 0 ? '' : 'none';
}

// ============================================================
// Excel Export
// ============================================================

async function handleExportExcel() {
  if (STATE.files.length === 0) {
    setStatus('Keine Dateien geladen. Bitte zuerst SOR-Dateien öffnen.');
    return;
  }

  const s = STATE.settings;

  // Dateinamen vorschlagen
  const cableId = s.cableId || 'OTDR_Messung';
  const dateStr = (s.date || new Date().toISOString().split('T')[0]).replace(/-/g, '');
  const defaultName = `${cableId}_Messdokumentation_${dateStr}.xlsx`;

  const saveResult = await window.electronAPI.saveExcel(defaultName);
  if (saveResult.canceled || !saveResult.filePath) return;

  setStatus('Excel-Datei wird erstellt...');

  try {
    // Projekt-Info zusammenstellen
    const projectInfo = {
      cableId: s.cableId || STATE.files[0]?.cableId || 'Unbekannt',
      project: s.project || '',
      locationA: s.locationA || STATE.files.find(f => f.locationA)?.locationA || '—',
      locationB: s.locationB || STATE.files.find(f => f.locationB)?.locationB || '—',
      technician: s.technician || STATE.files.find(f => f.operator)?.operator || '—',
      date: s.date ? new Date(s.date).toLocaleDateString('de-CH') : new Date().toLocaleDateString('de-CH'),
      fiberCount: Object.keys(STATE.fiberGroups).length,
      device: STATE.files.find(f => f.device)?.device || '—'
    };

    // Logo-Pfad: APP_PATH kommt aus Preload (absoluter Pfad zum App-Verzeichnis)
    const logoPath = window.APP_PATH
      ? window.APP_PATH.replace(/\\/g, '/') + '/logo.jpg'
      : null;

    const buffer = await window.excelExport.exportToExcel({
      fiberGroups: STATE.fiberGroups,
      projectInfo,
      limits: {
        limit1310: s.limit1310,
        limit1550: s.limit1550,
        plan1310: s.plan1310,
        plan1550: s.plan1550
      },
      logoPath
    });

    // Datei speichern
    const writeResult = await window.electronAPI.writeFile(saveResult.filePath, buffer);

    if (writeResult.success) {
      setStatus(`✓ Excel exportiert: ${saveResult.filePath}`);
      // Im Explorer anzeigen
      await window.electronAPI.showInExplorer(saveResult.filePath);
    } else {
      setStatus(`Fehler beim Speichern: ${writeResult.error}`);
    }
  } catch (err) {
    console.error('Excel-Export-Fehler:', err);
    setStatus(`Export-Fehler: ${err.message}`);
  }
}

async function handleExportAll() {
  // Gleich wie handleExportExcel (alle Fasern sind immer enthalten)
  await handleExportExcel();
}

// ============================================================
// Leeren
// ============================================================

function handleClear() {
  STATE.files = [];
  STATE.fiberGroups = {};
  STATE.traceCache.clear();
  STATE.selectedFiber = null;

  // UI zurücksetzen
  document.getElementById('fiber-list').querySelectorAll('.fiber-item').forEach(el => el.remove());
  document.getElementById('sidebar-empty-state').style.display = '';
  document.getElementById('chart-title').textContent = 'Kein Faser ausgewählt';
  document.getElementById('meas-info').innerHTML = '';
  document.getElementById('events-tbody').innerHTML = `<tr><td colspan="9" style="text-align:center;color:var(--text-muted);padding:20px;">Keine Ereignisse</td></tr>`;
  document.getElementById('chart-empty').style.display = '';

  if (STATE.chart) {
    STATE.chart.data.datasets = [];
    STATE.chart.update();
  }

  updateSummaryBadges();
  updateTopBarInfo();
  disableButtons();
  setStatus('Bereit.');
}

// ============================================================
// Progress Bar
// ============================================================

function showProgress(show) {
  const el = document.getElementById('progress-overlay');
  el.classList.toggle('visible', show);
}

function hideProgress() {
  showProgress(false);
}

function updateProgress(current, total, filename) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  document.getElementById('progress-bar-fill').style.width = `${pct}%`;
  document.getElementById('progress-current').textContent = `${current} / ${total}`;
  document.getElementById('progress-pct').textContent = `${pct}%`;
  document.getElementById('progress-sub').textContent = filename || '';
}

// ============================================================
// Status Bar
// ============================================================

function setStatus(msg) {
  document.getElementById('status-msg').textContent = msg;
}

// ============================================================
// Button-States
// ============================================================

function enableButtons() {
  document.getElementById('btn-export').disabled = false;
  document.getElementById('btn-export-all').disabled = false;
  document.getElementById('btn-clear').disabled = false;
}

function disableButtons() {
  document.getElementById('btn-export').disabled = true;
  document.getElementById('btn-export-all').disabled = true;
  document.getElementById('btn-clear').disabled = true;
}

// ============================================================
// Bottom Panel Resize
// ============================================================

function initBottomResize() {
  const handle = document.getElementById('bottom-resize');
  const panel = document.getElementById('bottom-panel');
  let startY = 0;
  let startH = 0;

  handle.addEventListener('mousedown', (e) => {
    startY = e.clientY;
    startH = panel.offsetHeight;
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    e.preventDefault();
  });

  function onMouseMove(e) {
    const delta = startY - e.clientY;
    const newH = Math.max(100, Math.min(500, startH + delta));
    panel.style.height = newH + 'px';
  }

  function onMouseUp() {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  }
}

// ============================================================
// Hilfsfunktionen
// ============================================================

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
// Node.js Module im Renderer (über require – wegen contextIsolation
// laden wir sie über ein Helper-Script)
// ============================================================

// Buffer ist im Electron-Renderer verfügbar
// SOR-Parser und Excel-Export werden über window-Objekte bereitgestellt
// (siehe renderer-node-bridge.js welches über preload geladen wird)
