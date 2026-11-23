
const mineflayer = require('@wp2508/mineflayer');
const { mineflayer: startViewer } = require('prismarine-viewer');
const { Vec3 } = require('vec3');

let bot = null;
let io = null;
let viewerStarted = false;
let starting = false;

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

function log(message) {
    console.log('[MineCloud]', message);
    emit('log', message);
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

function closeViewer(target) {
    if (!target) return;

    try {
        if (target.viewer && typeof target.viewer.close === 'function') {
            target.viewer.close();
            log('3D Viewer закрыт.');
        }
    } catch (error) {
        log('Ошибка закрытия Viewer: ' + error.message);
    }

    viewerStarted = false;
}

function startBot(options, socketIO) {
    if (starting) {
        log('Бот уже запускается.');
        return;
    }

    if (bot) {
        log('Сначала останови предыдущего бота.');
        return;
    }

    io = socketIO || io;

    const host = options.host;
    const port = Number(options.port);
    const username = options.username || 'MineCloudBot';

    if (!host || !port) {
        log('Укажи IP и порт сервера.');
        return;
    }

    starting = true;

    log(`Подключение к ${host}:${port}...`);

    try {
        const newBot = mineflayer.createBot({
            host,
            port,
            username,
            auth: 'offline',
            version: '26.3'
        });

        bot = newBot;

        newBot.once('login', () => {
            starting = false;

            status.online = true;
            status.username = username;

            emit('status', status);
            log('Бот успешно вошёл на сервер.');
        });

        newBot.once('spawn', () => {
            if (bot !== newBot) return;

            log('Бот появился в мире.');

            if (!viewerStarted) {
                try {
                    startViewer(newBot, {
                        port: 3007,
                        firstPerson: true,
                        viewDistance: 6
                    });

                    viewerStarted = true;
                    log('3D Viewer запущен на порту 3007.');
                } catch (error) {
                    log('Ошибка Viewer: ' + error.message);
                }
            }

            updateInventory();
        });

        newBot.on('health', () => {
            if (bot !== newBot) return;

            status.health = newBot.health;
            status.food = newBot.food;

            emit('status', status);
        });

        newBot.on('inventoryUpdate', () => {
            if (bot === newBot) updateInventory();
        });

        newBot.on('heldItemChanged', () => {
            if (bot === newBot) updateInventory();
        });

        newBot.on('move', () => {
            if (bot !== newBot || !newBot.entity) return;

            lookState = {
                yaw: newBot.entity.yaw,
                pitch: newBot.entity.pitch
            };

            emit('position', {
                x: newBot.entity.position.x,
                y: newBot.entity.position.y,
                z: newBot.entity.position.z
            });
        });

        newBot.on('kicked', reason => {
            log('Бот отключён сервером: ' + String(reason));
        });

        newBot.on('error', error => {
            log('Ошибка Minecraft: ' + error.message);
        });

        newBot.on('end', () => {
            closeViewer(newBot);

            if (bot === newBot) {
                bot = null;
                starting = false;
            }

            status.online = false;
            emit('status', status);

            log('Бот отключился.');
        });

    } catch (error) {
        bot = null;
        starting = false;
        log('Ошибка запуска: ' + error.message);
    }
}

function stopBot() {
    if (!bot) {
        log('Бот уже остановлен.');
        return;
    }

    const oldBot = bot;

    // Сразу запрещаем новые команды
    bot = null;
    starting = false;

    // Освобождаем порт Viewer
    closeViewer(oldBot);

    status.online = false;
    emit('status', status);

    try {
        oldBot.quit();
    } catch (error) {
        log('Ошибка остановки: ' + error.message);
    }

    log('Бот остановлен.');
}

function move(direction, enabled) {
    if (!bot || !bot.entity) return;

    const allowed = [
        'forward',
        'back',
        'left',
        'right',
        'jump',
        'sprint',
        'sneak'
    ];

    if (!allowed.includes(direction)) return;

    bot.setControlState(direction, Boolean(enabled));
}

function look(yaw, pitch) {
    if (!bot || !bot.entity) return;

    const y = Number(yaw);
    const p = Number(pitch);

    if (!Number.isFinite(y) || !Number.isFinite(p)) return;

    bot.look(y, p, true);
}

function breakBlock() {
    if (!bot || !bot.entity) return;

    const block = bot.blockAtCursor(5);

    if (!block || block.name === 'air') return;

    if (bot.targetDigBlock) return;

    bot.dig(block).catch(error => {
        log('Ошибка ломания блока: ' + error.message);
    });
}

function placeBlock() {
    if (!bot || !bot.entity) return;

    const block = bot.blockAtCursor(5);

    if (!block) {
        log('Нет блока перед ботом.');
        return;
    }

    if (!bot.heldItem) {
        log('В руке нет предмета для установки.');
        return;
    }

    bot.placeBlock(block, new Vec3(0, 1, 0)).catch(error => {
        log('Ошибка установки блока: ' + error.message);
    });
}

function attack() {
    if (!bot || !bot.entity) return;

    const entity = bot.nearestEntity(entity =>
        entity.type === 'mob' || entity.type === 'player'
    );

    if (entity) bot.attack(entity);
}

function selectSlot(slot) {
    if (!bot) return;

    const number = Number(slot);

    if (!Number.isInteger(number) || number < 0 || number > 8) {
        return;
    }

    bot.setQuickBarSlot(number);
    updateInventory();
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
