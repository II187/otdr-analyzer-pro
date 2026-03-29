/**
 * OTDR Analyzer Pro - Electron Hauptprozess
 * 
 * Verwaltet das Anwendungsfenster, IPC-Kommunikation,
 * Dateidialoge und Menüstruktur.
 */

const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// Entwicklungsmodus erkennen
const isDev = process.argv.includes('--dev');

// Hauptfenster-Referenz global halten (Garbage Collection vermeiden)
let mainWindow = null;

/**
 * Erstellt das Hauptanwendungsfenster
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: 'OTDR Analyzer Pro',
    backgroundColor: '#1a1a2e',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: true
    },
    show: false, // Erst anzeigen wenn bereit (kein weißes Blitzen)
    frame: true,
    titleBarStyle: 'default'
  });

  // Icon setzen (falls vorhanden)
  const iconPath = path.join(__dirname, 'assets', 'icon.ico');
  if (fs.existsSync(iconPath)) {
    mainWindow.setIcon(iconPath);
  }

  // HTML laden
  mainWindow.loadFile('index.html');

  // Fenster anzeigen wenn bereit
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (isDev) {
      mainWindow.webContents.openDevTools();
    }
  });

  // Fenster-Events
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Menü erstellen
  createMenu();
}

/**
 * Erstellt die Menüleiste
 */
function createMenu() {
  const menuTemplate = [
    {
      label: 'Datei',
      submenu: [
        {
          label: 'Ordner öffnen...',
          accelerator: 'CmdOrCtrl+O',
          click: () => openFolder()
        },
        {
          label: 'Dateien öffnen...',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => openFiles()
        },
        { type: 'separator' },
        {
          label: 'Excel exportieren',
          accelerator: 'CmdOrCtrl+E',
          click: () => {
            if (mainWindow) mainWindow.webContents.send('menu-export-excel');
          }
        },
        {
          label: 'Alle exportieren',
          accelerator: 'CmdOrCtrl+Shift+E',
          click: () => {
            if (mainWindow) mainWindow.webContents.send('menu-export-all');
          }
        },
        { type: 'separator' },
        {
          label: 'Beenden',
          accelerator: 'CmdOrCtrl+Q',
          click: () => app.quit()
        }
      ]
    },
    {
      label: 'Ansicht',
      submenu: [
        {
          label: 'Aktualisieren',
          accelerator: 'F5',
          click: () => {
            if (mainWindow) mainWindow.reload();
          }
        },
        {
          label: 'DevTools',
          accelerator: 'F12',
          click: () => {
            if (mainWindow) mainWindow.webContents.toggleDevTools();
          }
        },
        { type: 'separator' },
        {
          label: 'Vollbild',
          accelerator: 'F11',
          click: () => {
            if (mainWindow) mainWindow.setFullScreen(!mainWindow.isFullScreen());
          }
        }
      ]
    },
    {
      label: 'Hilfe',
      submenu: [
        {
          label: 'GitHub Repository',
          click: () => shell.openExternal('https://github.com/ii187/otdr-analyzer-pro')
        },
        {
          label: 'Über OTDR Analyzer Pro',
          click: () => showAboutDialog()
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);
}

/**
 * Zeigt den Über-Dialog
 */
function showAboutDialog() {
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Über OTDR Analyzer Pro',
    message: 'OTDR Analyzer Pro',
    detail: `Version: ${app.getVersion()}\n\nProfessionelle OTDR SOR-Datei Analysesoftware\nfür die Schweizer Telekommunikationsdokumentation.\n\nUnterstützt: Bellcore SR-4731, EXFO T-BERD, VIAVI MAX\n\nOpen Source auf GitHub: https://github.com/ii187/otdr-analyzer-pro`,
    buttons: ['OK']
  });
}

/**
 * Öffnet Dialog zum Ordner auswählen
 */
async function openFolder() {
  if (!mainWindow) return;
  
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'OTDR-Ordner öffnen',
    properties: ['openDirectory'],
    buttonLabel: 'Ordner öffnen'
  });

  if (!result.canceled && result.filePaths.length > 0) {
    const folderPath = result.filePaths[0];
    // SOR-Dateien im Ordner suchen (auch Unterordner)
    const sorFiles = findSorFiles(folderPath);
    
    if (sorFiles.length === 0) {
      dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'Keine Dateien gefunden',
        message: `Keine SOR-Dateien im Ordner gefunden:\n${folderPath}`,
        buttons: ['OK']
      });
      return;
    }

    mainWindow.webContents.send('files-opened', { 
      files: sorFiles, 
      folder: folderPath 
    });
  }
}

/**
 * Öffnet Dialog zur Dateiauswahl
 */
async function openFiles() {
  if (!mainWindow) return;
  
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'SOR-Dateien öffnen',
    filters: [
      { name: 'OTDR SOR Dateien', extensions: ['sor', 'SOR'] },
      { name: 'Alle Dateien', extensions: ['*'] }
    ],
    properties: ['openFile', 'multiSelections'],
    buttonLabel: 'Öffnen'
  });

  if (!result.canceled && result.filePaths.length > 0) {
    mainWindow.webContents.send('files-opened', { 
      files: result.filePaths,
      folder: null
    });
  }
}

/**
 * Sucht rekursiv nach SOR-Dateien in einem Ordner
 * @param {string} folderPath - Zu durchsuchender Ordner
 * @param {string[]} results - Ergebnisliste (rekursiv)
 * @returns {string[]} Gefundene SOR-Dateipfade
 */
function findSorFiles(folderPath, results = []) {
  try {
    const entries = fs.readdirSync(folderPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(folderPath, entry.name);
      
      if (entry.isDirectory()) {
        // Versteckte Ordner überspringen
        if (!entry.name.startsWith('.')) {
          findSorFiles(fullPath, results);
        }
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.sor')) {
        results.push(fullPath);
      }
    }
  } catch (err) {
    console.error(`Fehler beim Lesen von Ordner ${folderPath}:`, err);
  }
  
  return results;
}

// ============================================================
// IPC Handler
// ============================================================

/**
 * Datei lesen und als Buffer zurückgeben
 */
ipcMain.handle('read-file', async (event, filePath) => {
  try {
    const buffer = fs.readFileSync(filePath);
    return { 
      success: true, 
      data: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
      size: buffer.length
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

/**
 * Ordner öffnen (aus Renderer angefordert)
 */
ipcMain.handle('open-folder', async () => {
  await openFolder();
});

/**
 * Dateien öffnen (aus Renderer angefordert)
 */
ipcMain.handle('open-files', async () => {
  await openFiles();
});

/**
 * Excel-Datei speichern Dialog
 */
ipcMain.handle('save-excel', async (event, defaultName) => {
  if (!mainWindow) return { canceled: true };
  
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Excel exportieren',
    defaultPath: defaultName || 'OTDR_Messung.xlsx',
    filters: [
      { name: 'Excel Dateien', extensions: ['xlsx'] }
    ],
    buttonLabel: 'Exportieren'
  });

  return result;
});

/**
 * Datei schreiben
 */
ipcMain.handle('write-file', async (event, filePath, data) => {
  try {
    const buffer = Buffer.from(data);
    fs.writeFileSync(filePath, buffer);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

/**
 * Datei im Explorer anzeigen
 */
ipcMain.handle('show-in-explorer', async (event, filePath) => {
  shell.showItemInFolder(filePath);
});

/**
 * App-Version abrufen
 */
ipcMain.handle('get-version', () => app.getVersion());

// ============================================================
// App-Lifecycle
// ============================================================

app.whenReady().then(() => {
  createWindow();

  // macOS: Fenster neu erstellen wenn Dock-Icon geklickt
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Alle Fenster geschlossen (außer macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Unbehandelte Ausnahmen loggen
process.on('uncaughtException', (err) => {
  console.error('Unbehandelte Ausnahme:', err);
});
