
const express = require('express');
const http = require('http');
const net = require('net');
const dns = require('dns').promises;

const { Server } = require('socket.io');
const miner = require('./bot/miner');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    pingInterval: 25000,
    pingTimeout: 60000,
    connectTimeout: 30000
});

const VIEWER_HOST = '127.0.0.1';
const VIEWER_PORT = 3007;

app.use(express.static('public'));

// HTTP-прокси для страницы, файлов и ресурсов просмотрщика
app.use('/viewer', (req, res) => {
    const proxyRequest = http.request({
        hostname: VIEWER_HOST,
        port: VIEWER_PORT,
        path: req.originalUrl,
        method: req.method,
        headers: {
            ...req.headers,
            host: `${VIEWER_HOST}:${VIEWER_PORT}`
        }
    }, proxyResponse => {
        res.writeHead(
            proxyResponse.statusCode || 502,
            proxyResponse.headers
        );

        proxyResponse.pipe(res);
    });

    proxyRequest.on('error', error => {
        console.log('[VIEWER PROXY] HTTP:', error.message);

        if (!res.headersSent) {
            res.status(503).send(
                '3D-просмотрщик ещё не запущен. Подожди появления бота в мире.'
            );
        }
    });

    req.pipe(proxyRequest);
});

// WebSocket-прокси для передачи чанков и обновлений мира
server.on('upgrade', (req, clientSocket, head) => {
    let pathname;

    try {
        pathname = new URL(
            req.url,
            'http://localhost'
        ).pathname;
    } catch (error) {
        return;
    }

    if (!pathname.startsWith('/viewer/')) {
        return;
    }

    const viewerSocket = net.connect(
        VIEWER_PORT,
        VIEWER_HOST
    );

    viewerSocket.once('connect', () => {
        const headers = Object.entries(req.headers)
            .map(([name, value]) => {
                return `${name}: ${Array.isArray(value)
                    ? value.join(', ')
                    : value}`;
            })
            .join('\r\n');

        viewerSocket.write(
            `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n` +
            `${headers}\r\n\r\n`
        );

        if (head && head.length) {
            viewerSocket.write(head);
        }

        clientSocket.pipe(viewerSocket);
        viewerSocket.pipe(clientSocket);
    });

    viewerSocket.on('error', error => {
        console.log('[VIEWER PROXY] WebSocket:', error.message);
        clientSocket.destroy();
    });

    clientSocket.on('error', () => {
        viewerSocket.destroy();
    });

    clientSocket.on('close', () => {
        viewerSocket.destroy();
    });
});

// Проверка DNS и TCP до Aternos
let startInProgress = false;

async function testMinecraftConnection(host, port) {
    console.log(`[NETWORK] Проверяем DNS: ${host}`);

    const addresses = await dns.lookup(host, {
        all: true,
        verbatim: true
    });

    if (!addresses.length) {
        throw new Error('DNS не вернул IP-адреса');
    }

    console.log(
        '[NETWORK] Найдены IP:',
        addresses.map(a => a.address).join(', ')
    );

    let lastError = null;

    for (const address of addresses) {
        console.log(
            `[NETWORK] Проверяем TCP ${address.address}:${port}`
        );

        try {
            await new Promise((resolve, reject) => {
                const connection = net.createConnection({
                    host: address.address,
                    port,
                    family: address.family
                });

                connection.setTimeout(8000);

                connection.once('connect', () => {
                    console.log(
                        `[NETWORK] TCP УСПЕХ: ${address.address}:${port}`
                    );

                    connection.destroy();
                    resolve();
                });

                connection.once('timeout', () => {
                    const error = new Error('TCP_TIMEOUT');
                    error.code = 'TCP_TIMEOUT';
                    connection.destroy(error);
                });

                connection.once('error', reject);
            });

            return address.address;
        } catch (error) {
            lastError = error;

            console.log(
                `[NETWORK] TCP ОШИБКА ${address.address}:`,
                error.code || error.message
            );
        }
    }

    throw lastError || new Error('TCP-подключение не удалось');
}

io.on('connection', socket => {
    console.log('[MineCloud] Сайт подключился:', socket.id);

    socket.emit('status', miner.getStatus());
    socket.emit('inventory', miner.getInventory());
    socket.emit('vitals', miner.getVitals());

    const look = miner.getLookState();

    if (look) {
        socket.emit('lookState', look);
    }

    // Если бот уже в мире, сообщаем новому посетителю,
    // что просмотрщик готов.
    if (miner.isViewerReady()) {
        socket.emit('viewerReady');
    }

    socket.on('startBot', async config => {
        if (startInProgress) {
            socket.emit('actionResult', {
                success: false,
                message: 'Проверка подключения уже выполняется'
            });
            return;
        }

        if (miner.getStatus().state !== 'offline') {
            socket.emit('actionResult', {
                success: false,
                message: 'Бот уже подключается или запущен'
            });
            return;
        }

        config = config || {};

        const host = String(config.host || '').trim();
        const port = Number(config.port);

        if (
            !host ||
            !Number.isInteger(port) ||
            port < 1 ||
            port > 65535
        ) {
            socket.emit('actionResult', {
                success: false,
                message: 'Проверь IP и порт сервера'
            });
            return;
        }

        startInProgress = true;

        try {
            io.emit(
                'log',
                'Проверяем подключение Render → Aternos...'
            );

            const ip = await testMinecraftConnection(host, port);

            io.emit(
                'log',
                `TCP-подключение успешно! IP: ${ip}`
            );

            const result = miner.startBot(io, config);

            socket.emit('actionResult', result);
        } catch (error) {
            const reason = error.code || error.message;

            console.log(
                '[NETWORK] Проверка не пройдена:',
                reason
            );

            io.emit(
                'log',
                `Ошибка проверки сети: ${reason}`
            );

            socket.emit('actionResult', {
                success: false,
                message: `Render не смог подключиться к Aternos: ${reason}`
            });
        } finally {
            startInProgress = false;
        }
    });

    socket.on('stopBot', () => {
        miner.stopBot(io);
    });

    socket.on('control', data => {
        if (!data || typeof data.control !== 'string') return;

        miner.controlBot(data.control, data.pressed);
    });

    socket.on('look', data => {
        miner.lookBot(data);
    });

    socket.on('selectSlot', slot => {
        miner.selectSlot(slot, io);
    });

    socket.on('mouseAction', data => {
        if (!data || !['left', 'right'].includes(data.button)) return;

        miner.setMouseAction(
            data.button,
            Boolean(data.pressed),
            io
        );
    });

    socket.on('releaseMouse', () => {
        miner.releaseMouseActions();
    });

    socket.on('disconnect', reason => {
        console.log('[MineCloud] Сайт отключился:', reason);

        miner.releaseControls();
        miner.releaseMouseActions();
    });

    socket.on('error', error => {
        console.log(
            '[MineCloud] Ошибка Socket.IO:',
            error.message
        );
    });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
    console.log(`MineCloud запущен: http://localhost:${PORT}`);
});
