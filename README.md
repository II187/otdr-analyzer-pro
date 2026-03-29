# OTDR Analyzer Pro

**Professionelle OTDR SOR-Datei Analysesoftware für die Schweizer Telekommunikationsdokumentation**

Entwickelt von [LWL-Techniker Schweiz GmbH](https://lwl-techniker.ch)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Electron](https://img.shields.io/badge/Electron-28-47848F?logo=electron)](https://www.electronjs.org/)
[![Platform](https://img.shields.io/badge/Platform-Windows-0078D6?logo=windows)](https://github.com/ii187/otdr-analyzer-pro/releases)

---

## Übersicht

OTDR Analyzer Pro ist eine Windows-Desktopanwendung zur Analyse von OTDR-Messdaten im Bellcore SR-4731 SOR-Format. Die Software unterstützt Messungen von EXFO T-BERD, VIAVI MAX und anderen kompatiblen OTDR-Geräten.

### Hauptfunktionen

- 📂 **Bulk-Import**: Scannt gesamte Ordner nach `.sor` Dateien (bis zu 288+ Dateien)
- 🔍 **Auto-Gruppierung**: Erkennt Fasernummer, Wellenlänge (1310/1550 nm) und Richtung (A→B / B→A) aus Dateinamen
- 📊 **Trace-Overlay**: Zeigt A→B und B→A Traces überlagert im Diagramm
- ✅ **Automatische Auswertung**: OK/NOK-Bewertung gegen konfigurierbare Grenzwerte
- 📋 **Excel-Export**: Professionelle Messdokumentation im LWL-Techniker Format (4 Sheets)
- ⚙ **Konfigurierbare Grenzwerte**: Pro Projekt einstellbar, persistiert

---

## Installation

### Voraussetzungen

- Windows 10/11 (64-bit)
- Node.js 18+ (für Entwicklung)
- npm 9+

### Aus dem Installer (Endnutzer)

1. `.exe`-Installer aus [Releases](https://github.com/ii187/otdr-analyzer-pro/releases) herunterladen
2. Installer ausführen
3. Anwendung starten

### Aus dem Quellcode (Entwickler)

```bash
# Repository klonen
git clone https://github.com/ii187/otdr-analyzer-pro.git
cd otdr-analyzer-pro

# Abhängigkeiten installieren
npm install

# Starten
npm start

# Entwicklermodus (mit DevTools)
npm run dev
```

### Windows .exe bauen

```bash
npm run build
# Output: dist/OTDR Analyzer Pro Setup 1.0.0.exe
```

---

## Dateiformat – Dateibenennungskonvention

Dateien werden automatisch nach Fasernummer, Wellenlänge und Richtung gruppiert:

```
Projekt__Kabel_FaserNr_Wellenlänge_Richtung.sor
```

**Beispiele:**
```
ZUI.A.95__001_1310_OE.sor   → Faser 1, 1310 nm, A→B
ZUI.A.95__001_1310_EO.sor   → Faser 1, 1310 nm, B→A
ZUI.A.95__001_1550_OE.sor   → Faser 1, 1550 nm, A→B
ZUI.A.95__096_1550_EO.sor   → Faser 96, 1550 nm, B→A
```

**Erkannte Richtungskürzel:**
- `OE` = A→B (Ost nach End)
- `EO` = B→A (End nach Ost)
- `AB` = A→B (alternativ)
- `BA` = B→A (alternativ)

---

## Excel-Export Format

Die exportierte `.xlsx`-Datei enthält 4 Sheets:

### Sheet 1: Plan
Statische Vorlage mit Projektinformationen, Grenzwerten und Planungsdaten.

### Sheet 2: Mittelwert ⭐
Hauptergebnistabelle – eine Zeile pro Faser und Wellenlänge:

| Nr. | Anfang → Ende | Ende → Anfang | Wellenlänge | Dämpfung A→B [dB] | Dämpfung B→A [dB] | Mittelwert [dB] | Status |
|-----|--------------|--------------|-------------|-------------------|-------------------|-----------------|--------|
| 1   | Technopark   | HG           | 1310 nm     | 0.892             | 0.887             | **0.890**       | ✓ OK   |
| 2   | Technopark   | HG           | 1550 nm     | 0.541             | 0.558             | **0.550**       | ✓ OK   |

### Sheet 3: OE (A→B Rohdaten)
Alle Einzelmessungen der Richtung A→B mit:
- Dateiname, Faser, Wellenlänge
- Gesamtverlust (OTDR) [dB]
- ORL [dB]
- Gesamte Länge [km]
- Max. Spleissverlust, Max. Anschlussverlust, Max. Reflexion [dB]
- Ereignisanzahl

### Sheet 4: EO (B→A Rohdaten)
Gleiche Struktur wie Sheet OE, für Richtung B→A.

---

## Grenzwerte (Standard)

| Parameter         | 1310 nm    | 1550 nm    |
|-------------------|-----------|-----------|
| Grenzwert         | 1.04 dB   | 0.67 dB   |
| Planwert          | 0.36 dB/km| 0.22 dB/km|

Grenzwerte sind über **Einstellungen** (⚙) individuell konfigurierbar.

---

## Unterstützte OTDR-Formate

| Hersteller | Modell               | Format              |
|-----------|---------------------|---------------------|
| EXFO      | T-BERD/MTS 8000     | Bellcore SR-4731    |
| VIAVI     | MAX 720/730/940     | Bellcore SR-4731    |
| Yokogawa  | AQ7280/AQ7290       | Bellcore SR-4731    |
| JDSU      | T-BERD 6000         | Bellcore SR-4731    |
| Anritsu   | MT9085              | Bellcore SR-4731    |

---

## Projektstruktur

```
otdr-analyzer/
├── main.js           Electron Hauptprozess (Fenster, IPC, Menü)
├── preload.js        Context Bridge (sicherer API-Zugang für Renderer)
├── renderer.js       UI-Logik, Chart, State-Management
├── sor-parser.js     SOR Binary Parser (Bellcore SR-4731)
├── excel-export.js   Excel-Generierung (ExcelJS, 4 Sheets)
├── index.html        UI-Struktur
├── styles.css        Dark Theme
├── logo.jpg          LWL-Techniker Logo
├── package.json      Projekt-Konfiguration & Build-Skripte
└── README.md         Diese Datei
```

---

## Technologie

| Komponente     | Technologie      | Version  |
|----------------|-----------------|---------|
| Desktop-Framework | Electron      | 28.x    |
| UI-Chart       | Chart.js         | 4.4.x   |
| Chart-Zoom     | chartjs-plugin-zoom | 2.x |
| Excel-Export   | ExcelJS          | 4.4.x   |
| Builder        | electron-builder | 24.x    |
| Laufzeit       | Node.js          | 18+     |

---

## Entwicklung

### SOR-Parser anpassen

Der SOR-Parser (`sor-parser.js`) implementiert den Bellcore SR-4731 Standard.
Für neue Gerätevarianten können die Block-Parser erweitert werden:

```javascript
// Eigenen Block-Parser hinzufügen:
function parseMyBlock(buf, block) {
  let off = block.offset;
  // ... Bytes lesen
  return { myField: buf.readUInt16LE(off) };
}
```

### Tests

```bash
# Einzelne SOR-Datei testen (Node.js):
node -e "
  const fs = require('fs');
  const parser = require('./sor-parser');
  const buf = fs.readFileSync('test.sor');
  const result = parser.parseSorFile(buf, true);
  console.log(JSON.stringify(result.measurements, null, 2));
"
```

---

## Lizenz

MIT License – siehe [LICENSE](LICENSE)

---

## Kontakt

**LWL-Techniker Schweiz GmbH**  
🌐 [www.lwl-techniker.ch](https://lwl-techniker.ch)  
📧 info@lwl-techniker.ch

---

*OTDR Analyzer Pro – Präzision in jedem dB.*
