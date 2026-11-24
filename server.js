
const express = require('express');
const http = require('http');
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
    console.log(`MineCloud запущен: http://localhost:${PORT}`);
});
