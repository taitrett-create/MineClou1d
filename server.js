
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');
const httpProxy = require('http-proxy');
const miner = require('./bot/miner');

// ========================================
// MINECLOUD DIAGNOSTICS
// ========================================

function showPackageVersion(packageName) {
    try {
        let currentPath = require.resolve(packageName);
        let folder = path.dirname(currentPath);

        while (true) {
            const packageFile = path.join(folder, 'package.json');

            if (fs.existsSync(packageFile)) {
                const data = JSON.parse(
                    fs.readFileSync(packageFile, 'utf8')
                );

                if (data.name === packageName) {
                    console.log(
                        `[DIAGNOSTICS] ${packageName}: ${data.version}`
                    );
                    console.log(`[DIAGNOSTICS] Путь: ${folder}`);
                    return;
                }
            }

            const parent = path.dirname(folder);

            if (parent === folder) break;

            folder = parent;
        }

        console.log(
            `[DIAGNOSTICS] ${packageName}: версия не найдена`
        );
    } catch (error) {
        console.log(
            `[DIAGNOSTICS] ${packageName}: НЕ НАЙДЕН`
        );
    }
}

console.log('========== MINECLOUD DIAGNOSTICS ==========');

showPackageVersion('@wp2508/mineflayer');
showPackageVersion('@wp2508/minecraft-protocol');
showPackageVersion('minecraft-protocol');
showPackageVersion('prismarine-viewer');

console.log('===========================================');

// ========================================
// SERVER
// ========================================

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    },
    pingInterval: 25000,
    pingTimeout: 60000,
    transports: ['polling', 'websocket']
});

// ========================================
// VIEWER PROXY
// ========================================

const viewerProxy = httpProxy.createProxyServer({
    target: 'http://127.0.0.1:3007',
    ws: true,
    changeOrigin: true
});

viewerProxy.on('error', (error, req, res) => {
    console.error('[VIEWER PROXY]', error.message);

    if (res && typeof res.writeHead === 'function') {
        if (!res.headersSent) {
            res.writeHead(502, {
                'Content-Type': 'text/plain'
            });
        }

        if (typeof res.end === 'function') {
            res.end('Minecraft Viewer is not running.');
        }

        return;
    }

    if (res && typeof res.destroy === 'function') {
        res.destroy();
    }
});

// ========================================
// EXPRESS
// ========================================

app.use(express.json());

app.use('/viewer', (req, res) => {
    viewerProxy.web(req, res, {
        target: 'http://127.0.0.1:3007'
    });
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => {
    res.json({
        online: true,
        name: 'MineCloud',
        viewer: '/viewer/'
    });
});

app.get('/', (req, res) => {
    res.sendFile(
        path.join(__dirname, 'public', 'index.html')
    );
});

// ========================================
// LOGGING
// ========================================

function log(message) {
    console.log('[MineCloud]', message);
    io.emit('log', message);
}

// ========================================
// SOCKET.IO
// ========================================

io.on('connection', socket => {
    log('Новое подключение к сайту: ' + socket.id);

    socket.emit('status', miner.getStatus());
    socket.emit('inventory', miner.getInventory());
    socket.emit('look', miner.getLookState());

    // START BOT
    function startBot(data = {}) {
        const options = {
            host: data.host || data.ip || data.serverIP,
            port: Number(data.port || data.serverPort),
            username:
                data.username ||
                data.nick ||
                data.nickname ||
                'MineCloudBot'
        };

        if (!options.host || !options.port) {
            socket.emit(
                'log',
                'Ошибка: укажи IP и порт сервера.'
            );
            return;
        }

        log(
            'Запуск бота: ' +
            options.host +
            ':' +
            options.port
        );

        miner.startBot(options, io);
    }

    socket.on('start', startBot);
    socket.on('startBot', startBot);
    socket.on('bot:start', startBot);

    // STOP BOT
    function stopBot() {
        miner.stopBot();
        log('Команда остановки бота.');
    }

    socket.on('stop', stopBot);
    socket.on('stopBot', stopBot);
    socket.on('bot:stop', stopBot);

    // MOVEMENT
    socket.on('move', data => {
        if (typeof data === 'string') {
            miner.move(data, true);
            return;
        }

        if (!data) return;

        const direction = data.direction || data.control;

        if (direction) {
            miner.move(
                direction,
                data.enabled ?? data.state ?? true
            );
        }
    });

    // CAMERA
    socket.on('look', data => {
        if (!data) return;

        miner.look(
            Number(data.yaw),
            Number(data.pitch)
        );
    });

    // BLOCKS
    socket.on('breakBlock', () => {
        miner.breakBlock();
    });

    socket.on('break', () => {
        miner.breakBlock();
    });

    socket.on('placeBlock', () => {
        miner.placeBlock();
    });

    socket.on('place', () => {
        miner.placeBlock();
    });

    // ATTACK
    socket.on('attack', () => {
        miner.attack();
    });

    // INVENTORY
    socket.on('selectSlot', slot => {
        miner.selectSlot(slot);
    });

    // DISCONNECT
    socket.on('disconnect', reason => {
        log('Отключение сайта: ' + reason);
    });
});

// ========================================
// VIEWER WEBSOCKET
// ========================================

server.on('upgrade', (req, socket, head) => {
    if (req.url.startsWith('/viewer')) {
        req.url =
            req.url.replace(/^\/viewer/, '') || '/';

        viewerProxy.ws(req, socket, head, {
            target: 'http://127.0.0.1:3007'
        });
    }
});

// ========================================
// ERROR HANDLING
// ========================================

server.on('error', error => {
    console.error('[SERVER ERROR]', error);
});

process.on('uncaughtException', error => {
    console.error('[UNCAUGHT EXCEPTION]', error);
});

process.on('unhandledRejection', error => {
    console.error('[UNHANDLED REJECTION]', error);
});

// ========================================
// START
// ========================================

const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
    console.log('================================');
    console.log('       MINECLOUD STARTED');
    console.log('       PORT: ' + PORT);
    console.log('================================');
});
