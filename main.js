
const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  // Crea la ventana del navegador.
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    icon: path.join(__dirname, 'assets/icon.png') // Opcional: para el ícono de la ventana
  });

  // y carga el index.html de la aplicación.
  win.loadFile('index.html');

  // Abre las herramientas de desarrollo (opcional).
  // win.webContents.openDevTools();
}

// Este método se llamará cuando Electron haya finalizado
// la inicialización y esté listo para crear ventanas del navegador.
// Algunas APIs solo se pueden usar después de que ocurra este evento.
app.whenReady().then(createWindow);

// Sal cuando todas las ventanas estén cerradas, excepto en macOS. En macOS, es
// común que las aplicaciones y su barra de menús permanezcan activas hasta que el usuario
// salga explícitamente con Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // En macOS, es común volver a crear una ventana en la aplicación cuando el
  // icono del dock se hace clic y no hay otras ventanas abiertas.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
