
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const httpProxy = require('http-proxy');
const miner = require('./bot/miner');

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

// Прокси для Minecraft Viewer
const viewerProxy = httpProxy.createProxyServer({
    target: 'http://127.0.0.1:3007',
    ws: true,
    changeOrigin: true
});

viewerProxy.on('error', (error, req, res) => {
    console.error('[VIEWER PROXY]', error.message);

    if (res && !res.headersSent) {
        res.writeHead(502, {
            'Content-Type': 'text/plain'
        });
        res.end('Minecraft Viewer is not running.');
    }
});

app.use(express.json());

// Viewer должен идти через основной адрес Render
app.use('/viewer', (req, res) => {
    viewerProxy.web(req, res, {
        target: 'http://127.0.0.1:3007'
    });
});

// Статические файлы сайта
app.use(express.static(path.join(__dirname, 'public')));

// Проверка сервера
app.get('/health', (req, res) => {
    res.json({
        online: true,
        name: 'MineCloud',
        viewer: 'http://127.0.0.1:3007'
    });
});

// Главная страница
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

function log(message) {
    console.log('[MineCloud]', message);
    io.emit('log', message);
}

io.on('connection', socket => {
    log('Новое подключение к сайту: ' + socket.id);

    socket.emit('status', miner.getStatus());
    socket.emit('inventory', miner.getInventory());
    socket.emit('look', miner.getLookState());

    function startBot(data = {}) {
        const options = {
            host: data.host || data.ip || data.serverIP,
            port: Number(data.port || data.serverPort),
            username: data.username || data.nick || data.nickname || 'MineCloudBot'
        };

        if (!options.host || !options.port) {
            socket.emit('log', 'Ошибка: укажи IP и порт сервера.');
            return;
        }

        log('Запуск бота: ' + options.host + ':' + options.port);
        miner.startBot(options, io);
    }

    socket.on('start', startBot);
    socket.on('startBot', startBot);
    socket.on('bot:start', startBot);

    function stopBot() {
        miner.stopBot();
        log('Команда остановки бота.');
    }

    socket.on('stop', stopBot);
    socket.on('stopBot', stopBot);
    socket.on('bot:stop', stopBot);

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

    socket.on('look', data => {
        if (!data) return;

        miner.look(
            Number(data.yaw),
            Number(data.pitch)
        );
    });

    socket.on('breakBlock', () => miner.breakBlock());
    socket.on('break', () => miner.breakBlock());

    socket.on('placeBlock', () => miner.placeBlock());
    socket.on('place', () => miner.placeBlock());

    socket.on('attack', () => miner.attack());

    socket.on('selectSlot', slot => {
        miner.selectSlot(slot);
    });

    socket.on('disconnect', reason => {
        log('Отключение сайта: ' + reason);
    });
});

// WebSocket-прокси для Viewer
server.on('upgrade', (req, socket, head) => {
    if (req.url.startsWith('/viewer')) {
        req.url = req.url.replace(/^\/viewer/, '') || '/';

        viewerProxy.ws(req, socket, head, {
            target: 'http://127.0.0.1:3007'
        });
    }
});

server.on('error', error => {
    console.error('[SERVER ERROR]', error);
});

process.on('uncaughtException', error => {
    console.error('[UNCAUGHT EXCEPTION]', error);
});

process.on('unhandledRejection', error => {
    console.error('[UNHANDLED REJECTION]', error);
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
    console.log('================================');
    console.log('       MINECLOUD STARTED');
    console.log('       PORT: ' + PORT);
    console.log('       VIEWER: /viewer/');
    console.log('================================');
});
