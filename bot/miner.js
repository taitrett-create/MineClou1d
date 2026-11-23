
const mineflayer = require('@wp2508/mineflayer');
const { mineflayer: viewer } = require('prismarine-viewer');

let bot = null;
let io = null;
let viewerStarted = false;

let status = {
    online: false,
    username: '',
    health: 20,
    food: 20,
    version: '26.3'
};

let inventory = [];
let lookState = {
    yaw: 0,
    pitch: 0
};

function emit(event, data) {
    if (io) io.emit(event, data);
}

function getStatus() {
    return status;
}

function getInventory() {
    return inventory;
}

function getLookState() {
    return lookState;
}

function updateInventory() {
    if (!bot) return;

    inventory = bot.inventory.slots.map((item, slot) => {
        if (!item) return null;

        return {
            slot,
            name: item.name,
            displayName: item.displayName,
            count: item.count
        };
    });

    emit('inventory', inventory);
}

function startBot(options, socketIO) {
    if (bot) {
        stopBot();
    }

    io = socketIO;

    const host = options.host;
    const port = Number(options.port);
    const username = options.username || 'MineCloudBot';

    if (!host || !port) {
        emit('log', 'Укажи IP и порт сервера.');
        return;
    }

    emit('log', `Подключение к ${host}:${port}...`);

    try {
        bot = mineflayer.createBot({
            host,
            port,
            username,
            auth: 'offline',
            version: '26.3',
            hideErrors: false
        });

        bot.once('login', () => {
            status.online = true;
            status.username = username;

            emit('status', status);
            emit('log', 'Бот успешно вошёл на сервер.');
        });

        bot.once('spawn', () => {
            emit('log', 'Бот появился в мире.');

            try {
                viewer(bot, {
                    port: 3007,
                    firstPerson: true,
                    viewDistance: 6
                });

                viewerStarted = true;
                emit('log', '3D Viewer запущен на порту 3007.');
            } catch (error) {
                emit('log', 'Ошибка Viewer: ' + error.message);
            }

            updateInventory();
        });

        bot.on('health', () => {
            status.health = bot.health;
            status.food = bot.food;
            emit('status', status);
        });

        bot.on('inventoryUpdate', updateInventory);

        bot.on('heldItemChanged', updateInventory);

        bot.on('move', () => {
            if (!bot || !bot.entity) return;

            lookState = {
                yaw: bot.entity.yaw,
                pitch: bot.entity.pitch
            };

            emit('position', {
                x: bot.entity.position.x,
                y: bot.entity.position.y,
                z: bot.entity.position.z
            });
        });

        bot.on('kicked', reason => {
            emit('log', 'Бот отключён сервером: ' + reason);
        });

        bot.on('error', error => {
            emit('log', 'Ошибка Minecraft: ' + error.message);
        });

        bot.on('end', () => {
            status.online = false;
            emit('status', status);
            emit('log', 'Бот отключился.');
            bot = null;
            viewerStarted = false;
        });

    } catch (error) {
        emit('log', 'Ошибка запуска: ' + error.message);
    }
}

function stopBot() {
    if (!bot) return;

    try {
        bot.quit();
    } catch (error) {
        emit('log', error.message);
    }

    bot = null;
    viewerStarted = false;
    status.online = false;
    emit('status', status);
    emit('log', 'Бот остановлен.');
}

function move(direction, enabled) {
    if (!bot || !bot.entity) return;
    bot.setControlState(direction, Boolean(enabled));
}

function look(yaw, pitch) {
    if (!bot || !bot.entity) return;

    bot.look(Number(yaw), Number(pitch), true);
}

function breakBlock() {
    if (!bot || !bot.entity) return;

    const block = bot.blockAtCursor(5);

    if (!block || block.name === 'air') return;

    bot.dig(block).catch(error => {
        emit('log', 'Ошибка ломания блока: ' + error.message);
    });
}

function placeBlock() {
    if (!bot || !bot.entity) return;

    const block = bot.blockAtCursor(5);

    if (!block) return;

    const item = bot.heldItem;

    if (!item) {
        emit('log', 'В руке нет блока.');
        return;
    }

    const face = new (require('vec3').Vec3)(0, 1, 0);

    bot.placeBlock(block, face).catch(error => {
        emit('log', 'Ошибка установки блока: ' + error.message);
    });
}

function attack() {
    if (!bot || !bot.entity) return;

    const entity = bot.nearestEntity(entity => {
        return entity.type === 'mob' || entity.type === 'player';
    });

    if (entity) bot.attack(entity);
}

function selectSlot(slot) {
    if (!bot) return;

    const number = Number(slot);

    if (number < 0 || number > 8) return;

    bot.setQuickBarSlot(number);
}

function getBot() {
    return bot;
}

module.exports = {
    startBot,
    stopBot,
    getStatus,
    getInventory,
    getLookState,
    move,
    look,
    breakBlock,
    placeBlock,
    attack,
    selectSlot,
    getBot
};
