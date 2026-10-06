const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const AdmZip = require('adm-zip');
const { Client, Authenticator } = require('minecraft-launcher-core');

let mainWindow;
const launcher = new Client();

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 950,
        height: 600,
        resizable: false,
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    mainWindow.loadFile('index.html');
}

app.whenReady().then(createWindow);

// Обработка клика по кнопке «ИГРАТЬ» из index.html
ipcMain.on('launch-game', async (event, { username, versionConfig }) => {
    try {
        const mcRoot = path.join(app.getPath('userData'), 'minecraft_data');
        const versionPath = path.join(mcRoot, 'versions', versionConfig.id);
        const tempZipPath = path.join(app.getPath('userData'), 'temp_client.zip');

        // 1. Если версия еще не скачана — загружаем с GitHub Releases
        if (!fs.existsSync(versionPath)) {
            event.reply('status-update', 'Скачивание сборки с GitHub...');

            const writer = fs.createWriteStream(tempZipPath);
            const response = await axios({
                url: versionConfig.downloadUrl,
                method: 'GET',
                responseType: 'stream'
            });

            const totalLength = parseInt(response.headers['content-length'], 10);
            let downloaded = 0;

            response.data.on('data', (chunk) => {
                downloaded += chunk.length;
                if (totalLength) {
                    const percent = Math.round((downloaded / totalLength) * 100);
                    event.reply('status-update', `Загрузка с GitHub: ${percent}%`);
                }
            });

            response.data.pipe(writer);

            await new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
            });

            // 2. Распаковка архива
            event.reply('status-update', 'Распаковка файлов игры...');
            const zip = new AdmZip(tempZipPath);
            zip.extractAllTo(mcRoot, true);

            // Удаляем временный zip
            if (fs.existsSync(tempZipPath)) {
                fs.unlinkSync(tempZipPath);
            }
        }

        // 3. Запуск Minecraft в Offline/Локальном режиме
        event.reply('status-update', 'Запуск Minecraft...');

        const opts = {
            authorization: Authenticator.getAuth(username), // Offline UUID + Ник
            root: mcRoot,
            version: {
                number: versionConfig.id,
                type: "release"
            },
            memory: { max: "4G", min: "2G" },
            skipNativeInstall: true // Отключаем запросы к Mojang
        };

        launcher.launch(opts);

        launcher.on('start', () => {
            event.reply('status-update', 'Игра запущена!');
        });

        launcher.on('close', () => {
            event.reply('status-update', 'Готов к запуску');
        });

    } catch (error) {
        console.error(error);
        event.reply('status-update', 'Ошибка: ' + error.message);
    }
});