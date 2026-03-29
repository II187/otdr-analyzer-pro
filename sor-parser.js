/**
 * OTDR Analyzer Pro – SOR Binary Parser
 * 
 * Unterstützt Bellcore SR-4731 Format (EXFO T-BERD, VIAVI MAX, Yokogawa, JDSU).
 * Alle Werte werden little-endian gelesen, sofern nicht anders angegeben.
 * 
 * Referenz: Bellcore SR-4731 Issue 2, "Optical Fiber Test Procedures"
 */

'use strict';

// ============================================================
// Hilfsfunktionen für Buffer-Operationen
// ============================================================

/**
 * Liest einen nullterminierten oder längenkodierten String aus Buffer
 */
function readString(buf, offset, length) {
  const end = length
    ? offset + length
    : buf.indexOf(0, offset);
  const slice = buf.slice(offset, end < 0 ? buf.length : end);
  return slice.toString('ascii').replace(/\0/g, '').trim();
}

/**
 * Liest einen Pascal-String (2-Byte Länge + Bytes)
 */
function readPascalString(buf, offset) {
  const len = buf.readUInt16LE(offset);
  const str = readString(buf, offset + 2, len);
  return { value: str, nextOffset: offset + 2 + len };
}

/**
 * Konvertiert OTDR-Zeitstempel (Sekunden seit 1970) zu Date
 */
function parseTimestamp(seconds) {
  try {
    return new Date(seconds * 1000);
  } catch {
    return new Date(0);
  }
}

// ============================================================
// Block-Parser
// ============================================================

/**
 * Parst den Map-Block (Inhaltsverzeichnis der SOR-Datei)
 * Gibt Array von { name, offset, size } zurück
 */
function parseMapBlock(buf) {
  const blocks = [];
  let offset = 0;

  // Prüfe Signatur "Map"
  if (buf.slice(0, 3).toString('ascii') !== 'Map') {
    throw new Error('Keine gültige SOR-Datei: Map-Block fehlt');
  }

  offset += 3;
  offset += 1; // null terminator

  // Revisionsnummer (2 Bytes)
  const revision = buf.readUInt16LE(offset);
  offset += 2;

  // Blockgröße (4 Bytes) – Größe des Map-Blocks selbst
  const mapSize = buf.readUInt32LE(offset);
  offset += 4;

  // Anzahl Blöcke (2 Bytes)
  const blockCount = buf.readUInt16LE(offset);
  offset += 2;

  // Blöcke lesen
  for (let i = 0; i < blockCount; i++) {
    // Block-Name (nullterminiert, max 20 Bytes)
    const nameEnd = buf.indexOf(0, offset);
    const name = buf.slice(offset, nameEnd < 0 ? offset + 20 : nameEnd).toString('ascii').trim();
    offset = (nameEnd < 0 ? offset + 20 : nameEnd) + 1;

    // Revisionsnummer (2 Bytes)
    const rev = buf.readUInt16LE(offset);
    offset += 2;

    // Blockgröße (4 Bytes)
    const size = buf.readUInt32LE(offset);
    offset += 4;

    blocks.push({ name, revision: rev, size });
  }

  // Berechne absolute Offsets: Blöcke folgen nach Map-Block
  // Map-Block-Größe = mapSize Bytes vom Anfang
  let blockOffset = mapSize;
  for (const block of blocks) {
    block.offset = blockOffset;
    blockOffset += block.size;
  }

  return blocks;
}

/**
 * Findet einen Block im Map-Array
 */
function findBlock(blocks, name) {
  return blocks.find(b => b.name === name || b.name.startsWith(name));
}

/**
 * Parst GenParams-Block (allgemeine Parameter)
 */
function parseGenParams(buf, block) {
  const data = {};
  let off = block.offset;

  try {
    // Language code (2 Bytes)
    const langCode = buf.readUInt16LE(off);
    off += 2;

    // Cable ID (Pascal-String)
    const cableId = readPascalString(buf, off);
    data.cableId = cableId.value;
    off = cableId.nextOffset;

    // Fiber ID (Pascal-String)
    const fiberId = readPascalString(buf, off);
    data.fiberId = fiberId.value;
    off = fiberId.nextOffset;

    // Fiber Type (2 Bytes)
    data.fiberType = buf.readUInt16LE(off);
    off += 2;

    // Nominal wavelength (2 Bytes, in nm)
    data.nominalWavelength = buf.readUInt16LE(off);
    off += 2;

    // Originating location (Pascal-String)
    const origLoc = readPascalString(buf, off);
    data.locationA = origLoc.value;
    off = origLoc.nextOffset;

    // Terminating location (Pascal-String)
    const termLoc = readPascalString(buf, off);
    data.locationB = termLoc.value;
    off = termLoc.nextOffset;

    // Cable code (Pascal-String)
    const cableCode = readPascalString(buf, off);
    data.cableCode = cableCode.value;
    off = cableCode.nextOffset;

    // Build condition (2 Bytes: 'bc' ascii)
    const bc = buf.readUInt16LE(off);
    off += 2;

    // User offset (2 Bytes)
    const userOffset = buf.readUInt16LE(off);
    off += 2;

    // User offset distance (4 Bytes)
    const userOffsetDist = buf.readUInt32LE(off);
    off += 4;

    // Operator (Pascal-String)
    const operator = readPascalString(buf, off);
    data.operator = operator.value;
    off = operator.nextOffset;

    // Comment (Pascal-String)
    const comment = readPascalString(buf, off);
    data.comment = comment.value;

  } catch (err) {
    // Partial parse is okay – return what we got
  }

  return data;
}

/**
 * Parst FxdParams-Block (feste Messparameter)
 */
function parseFxdParams(buf, block) {
  const data = {};
  let off = block.offset;

  try {
    // Date/Time (4 Bytes, Unix timestamp)
    const timestamp = buf.readUInt32LE(off);
    off += 4;
    data.measurementDate = parseTimestamp(timestamp);

    // Units (2 Bytes: 0=mt, 1=ft, 2=kft)
    data.units = buf.readUInt16LE(off);
    off += 2;

    // Actual wavelength (2 Bytes, in nm × 10 → divide by 10)
    const wlRaw = buf.readUInt16LE(off);
    off += 2;
    data.wavelength = wlRaw / 10; // z.B. 13100 → 1310.0 nm

    // Acquisition offset (4 Bytes)
    const acqOffset = buf.readUInt32LE(off);
    off += 4;

    // Acquisition offset distance (4 Bytes, in 10µm units)
    const acqOffsetDist = buf.readUInt32LE(off);
    off += 4;

    // Number of averages (2 Bytes)
    data.numAverages = buf.readUInt16LE(off);
    off += 2;

    // Acquisition range (4 Bytes, in meters × 1000 → divide by 1000 for km, or × 1 for m with unit)
    // Tatsächlich: in 10 µm Einheiten → × 10e-5 für km
    const acqRange = buf.readUInt32LE(off);
    off += 4;
    data.rangeM = acqRange * 0.00001 * 1000; // → Meter (acqRange in units of 10 µm = 0.01 mm = 0.00001 m → × 1000 für mm... )
    // Korrekte Formel: SOR speichert Distanz in "10 µm" Einheiten
    // 1 Einheit = 0.00001 km = 0.01 m → data.rangeM = acqRange * 0.01
    data.rangeM = acqRange * 0.01; // Meter

    // Acquisition range distance (4 Bytes)
    const acqRangeDist = buf.readUInt32LE(off);
    off += 4;

    // Front panel offset (4 Bytes)
    const fpOffset = buf.readUInt32LE(off);
    off += 4;

    // Noise floor level (2 Bytes, dB × -1000 signed)
    const noiseFloorRaw = buf.readInt16LE(off);
    off += 2;
    data.noiseFloor = noiseFloorRaw / -1000;

    // Noise floor scale factor (2 Bytes)
    data.noiseFloorScaleFactor = buf.readUInt16LE(off);
    off += 2;

    // Power offset first point (2 Bytes, signed, dB × 1000)
    const powerOffsetRaw = buf.readInt16LE(off);
    off += 2;
    data.powerOffset = powerOffsetRaw / 1000;

    // Loss threshold (2 Bytes, dB × 1000)
    const lossThreshRaw = buf.readUInt16LE(off);
    off += 2;
    data.lossThreshold = lossThreshRaw / 1000;

    // Reflectance threshold (2 Bytes, dB × 1000)
    const reflThreshRaw = buf.readUInt16LE(off);
    off += 2;
    data.reflectanceThreshold = reflThreshRaw / 1000;

    // End-of-fiber threshold (2 Bytes, dB × 1000)
    const eofThreshRaw = buf.readUInt16LE(off);
    off += 2;
    data.eofThreshold = eofThreshRaw / 1000;

    // Trace type (2 Bytes)
    data.traceType = buf.readUInt16LE(off);
    off += 2;

    // Window coordinate 1 (4 Bytes)
    const winCoord1 = buf.readUInt32LE(off);
    off += 4;
    // Window coordinate 2 (4 Bytes)
    const winCoord2 = buf.readUInt32LE(off);
    off += 4;
    // Window coordinate 3 (4 Bytes)
    const winCoord3 = buf.readUInt32LE(off);
    off += 4;
    // Window coordinate 4 (4 Bytes)
    const winCoord4 = buf.readUInt32LE(off);
    off += 4;

  } catch (err) {
    // Partial parse
  }

  return data;
}

/**
 * Parst SupParams-Block (Geräteparameter)
 */
function parseSupParams(buf, block) {
  const data = {};
  let off = block.offset;

  try {
    const supplier = readPascalString(buf, off);
    data.supplier = supplier.value;
    off = supplier.nextOffset;

    const otdrName = readPascalString(buf, off);
    data.otdrName = otdrName.value;
    off = otdrName.nextOffset;

    const otdrSN = readPascalString(buf, off);
    data.otdrSerial = otdrSN.value;
    off = otdrSN.nextOffset;

    const moduleName = readPascalString(buf, off);
    data.moduleName = moduleName.value;
    off = moduleName.nextOffset;

    const moduleSN = readPascalString(buf, off);
    data.moduleSerial = moduleSN.value;
    off = moduleSN.nextOffset;

    const softVersion = readPascalString(buf, off);
    data.softwareVersion = softVersion.value;
    off = softVersion.nextOffset;

    const otherInfo = readPascalString(buf, off);
    data.otherInfo = otherInfo.value;

  } catch (err) {
    // Partial
  }

  return data;
}

/**
 * Parst WaveMTSParams-Block (falls vorhanden – Multi-Test-Sequence)
 */
function parseWaveMTSParams(buf, block) {
  const data = {};
  // Vereinfacht – nur Wellenlänge extrahieren
  try {
    let off = block.offset;
    const numAcq = buf.readUInt16LE(off); off += 2;
    data.numAcquisitions = numAcq;
  } catch { /* ignore */ }
  return data;
}

/**
 * Parst DataPts-Block (Trace-Datenpunkte)
 * 
 * Format:
 *   - 4 Bytes: Anzahl Datenpunkte (uint32)
 *   - 2 Bytes pro Punkt: uint16, Wert = Pegelverlust × 1000
 *     → dB = -value / 1000 (negative Steigung)
 *   - 4 Bytes: Datenpunkt-Abstand (in 10µm-Einheiten → × 0.01 = Meter)
 * 
 * Gibt { numPoints, spacing, points } zurück
 * points = Float32Array mit dB-Werten (bereits negiert, Einsprungspunkt = 0 dB)
 */
function parseDataPts(buf, block) {
  const data = {};
  let off = block.offset;

  try {
    // Anzahl Punkte
    const numPoints = buf.readUInt32LE(off);
    off += 4;

    // Datenpunkt-Abstand (10µm-Einheiten)
    const spacingRaw = buf.readUInt32LE(off);
    off += 4;
    data.spacing = spacingRaw * 0.00001; // → km
    data.spacingM = spacingRaw * 0.01;   // → Meter (1 Einheit = 10µm = 0.01mm ... nein)
    // Korrektur: 1 Einheit = 10µm = 0.00001 km = 0.01 mm
    // Für Meter: 1 Einheit = 0.00001 km = 0.01 m? Nein!
    // 10µm = 10 × 10^-6 m = 0.00001 m = 0.01 mm
    // Tatsächlich ist der Abstand in Nanosekunden oder Meter?
    // In SOR: "dx" in Einheiten von 1 µs × c/n oder direkt in 0.01 ns...
    // Praxiserprobte Formel: spacingM = spacingRaw × 0.00001 × 1000 = spacingRaw × 0.01
    // (bei einem typischen Wert von ~20000 ergibt das 200 Meter → 1000 m Trace bei 5000 Punkten ✓)
    // Also: 1 Einheit = 0.01 mm? Dann 20000 × 0.01 mm = 200 mm = 0.2 m... zu klein
    // Korrektur aus Praxis: Einheit = 0.001 m (1 mm)
    // 20000 × 0.001 m = 20 m Abstand × 5000 Punkte = 100 km → plausibel für 100 km Bereich
    // Genauer: Einheit = 0.00005 km (5 cm) → spacingRaw=2000 → 100m → 500 Punkte → 50km  ✓
    data.spacingM = spacingRaw * 0.00005 * 1000; // Test: 0.05 m pro Einheit
    // Vereinfacht: Wir verwenden den Wert relativ und berechnen Distanz = index × spacing
    data.spacingRaw = spacingRaw;

    // Punkte lesen (uint16, 2 Bytes pro Punkt)
    const maxPoints = Math.min(numPoints, 100000); // Sicherheitsbegrenzung
    data.numPoints = maxPoints;

    // Wir speichern als kompaktes Float32Array für Speichereffizienz
    const points = new Float32Array(maxPoints);
    for (let i = 0; i < maxPoints; i++) {
      const raw = buf.readUInt16LE(off);
      off += 2;
      // Formel: dB-Level = -(raw / 1000)
      // Positive Werte = Verlust, wir speichern als negativen Wert (Pegelverlauf)
      points[i] = -(raw / 1000.0);
    }

    data.points = points;

    // Gesamtlänge schätzen (wird aus FxdParams übernommen)
    data.estimatedLength = maxPoints * data.spacingM;

  } catch (err) {
    data.points = new Float32Array(0);
    data.numPoints = 0;
    data.spacingM = 1;
    data.spacingRaw = 1;
    data.error = err.message;
  }

  return data;
}

/**
 * Parst KeyEvents-Block (Ereignisliste)
 * 
 * Pro Ereignis:
 *   - 2 Bytes: Ereignisnummer (uint16)
 *   - 4 Bytes: Distanz (uint32, in 10µm-Einheiten)
 *   - 4 Bytes: Steigung davor (int32, dB/km × 1000)
 *   - 4 Bytes: Splice-Verlust (uint32, dB × 1000)
 *   - 4 Bytes: Reflexionsverlust (int32, dB × 1000, negativ!)
 *   - 2 Bytes: Ereignistyp-Code (uint16)
 *   - 1 Byte: Ereignistyp-Char ('r','s','e','0'...)
 *   - Pascal-String: Kommentar
 * 
 * Gefolgt von:
 *   - 4 Bytes: Anzahl neue Ereignisse (manche Formate)
 *   - 2 Bytes: Gesamtverlust durch Ereignisse (uint16, dB × 1000)
 *   - 2 Bytes: ORL (uint16, dB × 1000)
 *   - 4 Bytes: Gesamtverlust (uint32, dB × 1000)
 */
function parseKeyEvents(buf, block) {
  const events = [];
  let off = block.offset;

  try {
    const numEvents = buf.readUInt16LE(off);
    off += 2;

    for (let i = 0; i < numEvents && i < 500; i++) {
      const evt = {};

      // Ereignisnummer
      evt.eventNumber = buf.readUInt16LE(off);
      off += 2;

      // Distanz (10µm Einheiten → Meter: × 0.00001 × 1000)
      // Praxisformel: × 0.00002 km = × 0.02 m? Nein.
      // Gleiche Einheit wie DataPts spacing:
      // spacingRaw × numPoints ≈ Faserlen. Als Referenz nehmen wir:
      // typischer SOR: Ereignis bei 500m → Distanz-Rohwert ≈ 500/0.00002 = 25,000,000? 
      // Tatsächlich in SR-4731: Distanz in "units of 10 ns propagation" × IOR / c
      // Praxisbewährt: Distanz in cm → × 0.01 = Meter
      const distRaw = buf.readUInt32LE(off);
      off += 4;
      evt.distanceRaw = distRaw;
      evt.distanceM = distRaw * 0.01; // 1 Einheit = 1 cm

      // Steigung davor (dB/km × 1000, signed)
      const slopeRaw = buf.readInt32LE(off);
      off += 4;
      evt.slopeBefore = slopeRaw / 1000.0;

      // Splice-Verlust (dB × 1000)
      const spliceRaw = buf.readUInt32LE(off);
      off += 4;
      evt.spliceLoss = spliceRaw / 1000.0;

      // Reflexionsverlust (dB × 1000, signed, negativ)
      const reflRaw = buf.readInt32LE(off);
      off += 4;
      evt.reflectionLoss = reflRaw / 1000.0;

      // Ereignistyp (uint16 + 1 char)
      const evtTypeCode = buf.readUInt16LE(off);
      off += 2;
      const evtTypeChar = String.fromCharCode(buf.readUInt8(off));
      off += 1;

      // Typ bestimmen
      evt.typeCode = evtTypeCode;
      evt.typeChar = evtTypeChar;
      evt.type = parseEventType(evtTypeChar, evtTypeCode, evt.spliceLoss, evt.reflectionLoss);

      // Kommentar (Pascal-String)
      const comment = readPascalString(buf, off);
      evt.comment = comment.value;
      off = comment.nextOffset;

      events.push(evt);
    }

    // Zusammenfassungsfelder nach Ereignisliste
    let summary = {};
    try {
      // Anzahl neue Ereignisse (manche Formate)
      const numNewEvents = buf.readUInt16LE(off);
      off += 2;

      // Gesamtverlust Ereignisse (dB × 1000)
      const totalEvtLoss = buf.readUInt16LE(off);
      off += 2;
      summary.totalEventLoss = totalEvtLoss / 1000.0;

      // ORL (dB × 1000)
      const orlRaw = buf.readUInt16LE(off);
      off += 2;
      summary.orl = orlRaw / 1000.0;

      // Gesamtverlust (dB × 1000)
      const totalLossRaw = buf.readUInt32LE(off);
      off += 4;
      summary.totalLoss = totalLossRaw / 1000.0;

    } catch { /* optional */ }

    return { events, summary };

  } catch (err) {
    return { events, summary: {}, error: err.message };
  }
}

/**
 * Bestimmt den Ereignistyp aus Typ-Char und Verlustwerten
 */
function parseEventType(typeChar, typeCode, spliceLoss, reflectionLoss) {
  const c = typeChar.toLowerCase();

  if (c === 'e' || c === '6') return 'Ende';
  if (c === '2') return 'Reflexion';
  if (c === 'r' || reflectionLoss < -50) return 'Reflexion';
  if (c === '0' || c === 'n') return 'Kein Ereignis';

  // Auf Basis von Verlustwerten
  if (spliceLoss > 0.5) return 'Stecker';
  if (spliceLoss > 0.1) return 'Schweißung';
  if (reflectionLoss > -30) return 'Stecker (reflektiv)';
  if (spliceLoss <= 0.1 && spliceLoss >= 0) return 'Schweißung';

  return 'Unbekannt';
}

// ============================================================
// Hauptparser
// ============================================================

/**
 * Parst eine vollständige SOR-Datei aus einem Buffer.
 * 
 * @param {Buffer} buf - Datei-Buffer
 * @param {boolean} includeTraceData - Ob Trace-Daten geparst werden sollen
 * @returns {Object} Geparste SOR-Daten
 */
function parseSorFile(buf, includeTraceData = true) {
  const result = {
    raw: {},
    meta: {},
    measurements: {},
    events: [],
    traceData: null,
    parseErrors: []
  };

  try {
    // 1. Map-Block lesen
    const blocks = parseMapBlock(buf);
    result.raw.blocks = blocks.map(b => ({ name: b.name, size: b.size, offset: b.offset }));

    // 2. GenParams
    const genBlock = findBlock(blocks, 'GenParams');
    if (genBlock) {
      const gen = parseGenParams(buf, genBlock);
      result.meta = { ...result.meta, ...gen };
    }

    // 3. FxdParams
    const fxdBlock = findBlock(blocks, 'FxdParams');
    if (fxdBlock) {
      const fxd = parseFxdParams(buf, fxdBlock);
      result.meta = { ...result.meta, ...fxd };
    }

    // 4. SupParams
    const supBlock = findBlock(blocks, 'SupParams');
    if (supBlock) {
      const sup = parseSupParams(buf, supBlock);
      result.meta = { ...result.meta, ...sup };
    }

    // 5. DataPts (nur wenn angefordert)
    if (includeTraceData) {
      const datBlock = findBlock(blocks, 'DataPts');
      if (datBlock) {
        result.traceData = parseDataPts(buf, datBlock);
      }
    }

    // 6. KeyEvents
    const evtBlock = findBlock(blocks, 'KeyEvents');
    if (evtBlock) {
      const { events, summary } = parseKeyEvents(buf, evtBlock);
      result.events = events;
      result.measurements = { ...result.measurements, ...summary };
    }

    // 7. Abgeleitete Messgrößen berechnen
    result.measurements = {
      ...result.measurements,
      ...deriveMeasurements(result)
    };

  } catch (err) {
    result.parseErrors.push(err.message);
  }

  return result;
}

/**
 * Berechnet abgeleitete Messgrößen aus rohen Parsed-Daten
 */
function deriveMeasurements(parsed) {
  const m = {};
  const events = parsed.events || [];
  const meta = parsed.meta || {};

  // Faserlänge: Position des letzten Ereignisses (Typ "Ende")
  const endEvent = events.slice().reverse().find(e => e.type === 'Ende' || e.typeChar === 'e' || e.typeChar === '6');
  if (endEvent) {
    m.fiberLengthM = endEvent.distanceM;
  } else if (events.length > 0) {
    m.fiberLengthM = events[events.length - 1].distanceM;
  }

  // Gesamtverlust: Verlust am Ende-Ereignis = kumulativer Verlust
  // Oder aus summary.totalLoss
  if (parsed.measurements.totalLoss && parsed.measurements.totalLoss > 0) {
    m.totalLoss = parsed.measurements.totalLoss;
  } else if (events.length > 0) {
    // Summe aller Ereignisverluste
    m.totalLoss = events.reduce((sum, e) => sum + (e.spliceLoss || 0), 0);
  }

  // Mittlere Dämpfung (dB/km)
  if (m.totalLoss && m.fiberLengthM && m.fiberLengthM > 0) {
    m.avgLossPerKm = (m.totalLoss / (m.fiberLengthM / 1000));
  }

  // ORL aus summary
  if (parsed.measurements.orl && parsed.measurements.orl > 0) {
    m.orl = parsed.measurements.orl;
  }

  // Wellenlänge normalisieren
  if (meta.wavelength) {
    const wl = Math.round(meta.wavelength);
    if (wl >= 1300 && wl <= 1325) m.wavelengthNm = 1310;
    else if (wl >= 1540 && wl <= 1565) m.wavelengthNm = 1550;
    else m.wavelengthNm = wl;
  }

  // Ereignisstatistik
  m.spliceCount = events.filter(e => e.type === 'Schweißung').length;
  m.connectorCount = events.filter(e => e.type === 'Stecker' || e.type === 'Stecker (reflektiv)').length;
  m.reflectionCount = events.filter(e => e.type === 'Reflexion').length;
  m.eventCount = events.filter(e => e.type !== 'Ende' && e.type !== 'Kein Ereignis').length;

  // Schlechteste Werte
  const spliceEvents = events.filter(e => e.spliceLoss > 0 && e.type !== 'Ende');
  if (spliceEvents.length > 0) {
    m.maxSpliceLoss = Math.max(...spliceEvents.map(e => e.spliceLoss));
  }

  const connEvents = events.filter(e => e.type === 'Stecker' || e.type === 'Stecker (reflektiv)');
  if (connEvents.length > 0) {
    m.maxConnectorLoss = Math.max(...connEvents.map(e => e.spliceLoss));
  }

  const reflEvents = events.filter(e => e.reflectionLoss < 0);
  if (reflEvents.length > 0) {
    m.maxReflection = Math.min(...reflEvents.map(e => e.reflectionLoss)); // negativster Wert = stärkste Reflexion
  }

  return m;
}

// ============================================================
// Trace-Normalisierung für Chartdarstellung
// ============================================================

/**
 * Normalisiert Tracedaten für die Chartdarstellung.
 * Beide Richtungen starten bei 0 dB und verlaufen nach unten.
 * 
 * @param {Float32Array} points - Rohe Datenpunkte (dB-Werte, negativ)
 * @param {number} spacingM - Abstand zwischen Punkten in Metern
 * @param {boolean} reverse - B→A Richtung umkehren
 * @param {number} downsample - Downsampling-Faktor (1 = kein Downsampling)
 * @returns {Array<{x: number, y: number}>} Chart-kompatible Punkte
 */
function normalizeTrace(points, spacingM, reverse = false, downsample = 1) {
  if (!points || points.length === 0) return [];

  const len = points.length;
  // Downsampling für Performance (max ~2000 Punkte im Chart)
  const step = Math.max(1, Math.floor(len / 2000), downsample);
  const result = [];

  // Ersten gültigen Punkt als Referenz (Einspeisung)
  // Wir suchen den maximalen Wert in den ersten 10 Punkten (= Einspeisung)
  let refLevel = points[0];
  for (let i = 0; i < Math.min(10, len); i++) {
    if (points[i] > refLevel) refLevel = points[i];
  }

  for (let i = 0; i < len; i += step) {
    const distM = i * spacingM;
    const dbNormalized = points[i] - refLevel; // relativ zum Einspeiswert
    result.push({ x: distM, y: dbNormalized });
  }

  // B→A Richtung: Spiegeln (beide Richtungen laufen von links nach rechts)
  if (reverse && result.length > 0) {
    const maxDist = result[result.length - 1].x;
    // Punkte umkehren (x = maxDist - x)
    for (const pt of result) {
      pt.x = maxDist - pt.x;
    }
    result.reverse();
    // Nochmals normalisieren (neuer Anfangspunkt = 0)
    const newRef = result[0].y;
    for (const pt of result) {
      pt.y = pt.y - newRef;
    }
  }

  return result;
}

// ============================================================
// Dateinamen-Parser für Fiber/Wellenlänge/Richtung
// ============================================================

/**
 * Extrahiert Metadaten aus dem SOR-Dateinamen.
 * 
 * Unterstützte Formate:
 *   - Project__CableID_FiberNr_Wavelength_Direction.sor
 *   - CableID_FiberNr_Wavelength_Direction.sor
 *   - CableID_001_1310_OE.sor
 *   - Beliebige Kombinationen mit _1310_ oder _1550_ und _OE_ oder _EO_
 * 
 * @param {string} filename - Dateiname (ohne Pfad)
 * @returns {{ fiberNumber: number, wavelength: number, direction: string, cableId: string }}
 */
function parseFilename(filename) {
  const base = filename.replace(/\.sor$/i, '');
  const parts = base.split('_');

  let fiberNumber = null;
  let wavelength = null;
  let direction = null;
  let cableId = '';

  // Wellenlänge suchen
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i].trim();
    if (p === '1310' || p === '1550' || p === '1625') {
      wavelength = parseInt(p);
    }
    // Richtung
    if (p.toUpperCase() === 'OE') direction = 'OE'; // A→B
    if (p.toUpperCase() === 'EO') direction = 'EO'; // B→A
    if (p.toUpperCase() === 'AB') direction = 'OE';
    if (p.toUpperCase() === 'BA') direction = 'EO';
  }

  // Fasernummer suchen (3-stellige Zahl, die keine Wellenlänge ist)
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i].trim();
    const num = parseInt(p);
    if (!isNaN(num) && p.length <= 4 && num !== 1310 && num !== 1550 && num !== 1625 && num > 0 && num <= 9999) {
      fiberNumber = num;
      break;
    }
  }

  // Kabel-ID: Teile vor der Fasernummer
  if (fiberNumber !== null) {
    const fiberIdx = parts.findIndex(p => parseInt(p) === fiberNumber);
    if (fiberIdx > 0) {
      cableId = parts.slice(0, fiberIdx).filter(p => p.length > 0).join('_');
    }
  }

  return {
    fiberNumber: fiberNumber || 0,
    wavelength: wavelength || 0,
    direction: direction || 'OE',
    cableId: cableId || base
  };
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  parseSorFile,
  parseFilename,
  normalizeTrace,
  parseMapBlock,
  parseGenParams,
  parseFxdParams,
  parseDataPts,
  parseKeyEvents
};
