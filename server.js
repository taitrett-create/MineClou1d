
const express = require('express');
const http = require('http');
const net = require('net');
const { Server } = require('socket.io');
const miner = require('./bot/miner');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    pingInterval: 25000,
    pingTimeout: 60000,
    connectTimeout: 30000
});

app.use(express.static('public'));

// HTTP-прокси для 3D-просмотрщика
app.use('/viewer', (req, res) => {
    const proxyReq = http.request({
        hostname: '127.0.0.1',
        port: 3007,
        path: '/viewer' + req.url,
        method: req.method,
        headers: {
            ...req.headers,
            host: '127.0.0.1:3007'
        }
    }, proxyRes => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
    });

    proxyReq.on('error', error => {
        console.log('[VIEWER PROXY]', error.message);

        if (!res.headersSent) {
            res.status(502).send('3D-просмотрщик пока не запущен');
        }
    });

    req.pipe(proxyReq);
});

// WebSocket-прокси для 3D-просмотрщика
server.on('upgrade', (req, socket, head) => {
    if (!req.url.startsWith('/viewer/socket.io/')) return;

    const upstream = net.connect(3007, '127.0.0.1', () => {
        let request = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;

        for (let i = 0; i < req.rawHeaders.length; i += 2) {
            request += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
        }

        request += '\r\n';

        upstream.write(request);

        if (head && head.length) {
            upstream.write(head);
        }

        socket.pipe(upstream);
        upstream.pipe(socket);
    });

    upstream.on('error', error => {
        console.log('[VIEWER WS PROXY]', error.message);
        socket.destroy();
    });

    socket.on('error', () => upstream.destroy());
    socket.on('close', () => upstream.destroy());
});

// MineCloud Socket.IO
io.on('connection', socket => {
    console.log('[MineCloud] Сайт подключился:', socket.id);

    socket.emit('status', miner.getStatus());
    socket.emit('inventory', miner.getInventory());
    socket.emit('vitals', miner.getVitals());

    const look = miner.getLookState();
    if (look) socket.emit('lookState', look);

    socket.on('startBot', config => {
        const result = miner.startBot(io, config);
        socket.emit('actionResult', result);
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
        miner.setMouseAction(data.button, Boolean(data.pressed), io);
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
        console.log('[MineCloud] Ошибка Socket.IO:', error.message);
    });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
    console.log(`MineCloud запущен на порту ${PORT}`);
});
