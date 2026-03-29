/**
 * OTDR Analyzer Pro – Preload Script
 * 
 * Stellt via contextBridge bereit:
 * 1. electronAPI  – IPC-Funktionen (Dateien lesen/schreiben, Dialoge)
 * 2. sorParser    – SOR-Parser (Node.js Buffer-basiert)
 * 3. excelExport  – Excel-Export (ExcelJS)
 * 4. APP_PATH     – Pfad zum App-Verzeichnis (für Logo etc.)
 */

'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const path = require('path');

// Node.js Module laden
const sorParser = require('./sor-parser');
const excelExport = require('./excel-export');

// App-Verzeichnis
const appPath = __dirname;

// ============================================================
// electronAPI – IPC Bridge
// ============================================================

contextBridge.exposeInMainWorld('electronAPI', {
  // Datei-Operationen
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  writeFile: (filePath, data) => ipcRenderer.invoke('write-file', filePath, data),

  // Dialoge
  openFolder: () => ipcRenderer.invoke('open-folder'),
  openFiles: () => ipcRenderer.invoke('open-files'),
  saveExcel: (defaultName) => ipcRenderer.invoke('save-excel', defaultName),

  // Shell
  showInExplorer: (filePath) => ipcRenderer.invoke('show-in-explorer', filePath),

  // App-Info
  getVersion: () => ipcRenderer.invoke('get-version'),

  // Events vom Main-Prozess
  onFilesOpened:    (cb) => ipcRenderer.on('files-opened',    (_, data) => cb(data)),
  onMenuExportExcel:(cb) => ipcRenderer.on('menu-export-excel', () => cb()),
  onMenuExportAll:  (cb) => ipcRenderer.on('menu-export-all',   () => cb()),

  removeAllListeners: (ch) => ipcRenderer.removeAllListeners(ch)
});

// ============================================================
// sorParser – SOR-Datei-Parser
// ============================================================

contextBridge.exposeInMainWorld('sorParser', {
  parseSorFile:  (buf, includeTrace) => sorParser.parseSorFile(buf, includeTrace),
  parseFilename: (filename) => sorParser.parseFilename(filename),
  normalizeTrace:(points, spacingM, reverse) => sorParser.normalizeTrace(points, spacingM, reverse)
});

// ============================================================
// excelExport – Excel-Export
// ============================================================

contextBridge.exposeInMainWorld('excelExport', {
  exportToExcel: (params) => excelExport.exportToExcel(params)
});

// ============================================================
// APP_PATH – Pfad zum App-Verzeichnis
// ============================================================

contextBridge.exposeInMainWorld('APP_PATH', appPath);

// ============================================================
// Buffer – Node.js Buffer für Renderer bereitstellen
// ============================================================

// Buffer ist in Electron-Renderer normalerweise verfügbar,
// aber wir stellen es explizit sicher:
contextBridge.exposeInMainWorld('BufferUtils', {
  from: (data) => Buffer.from(data),
  alloc: (size) => Buffer.alloc(size),
  isBuffer: (obj) => Buffer.isBuffer(obj)
});
