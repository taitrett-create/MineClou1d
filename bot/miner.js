
const mineflayer = require('@wp2508/mineflayer');
const { mineflayer: startViewer } = require('prismarine-viewer');
const { Vec3 } = require('vec3');

const VIEWER_PORT = 3007;
const MINECRAFT_VERSION = '26.3';

let bot = null;
let io = null;
let starting = false;

let viewerStarted = false;
let viewerBot = null;

let connectionTimer = null;
let loadedChunks = 0;
let chunkPackets = 0;

let status = {
    online: false,
    username: '',
    health: 20,
    food: 20,
    version: false
};

let inventory = [];

let lookState = {
    yaw: 0,
    pitch: 0
};

function stringify(value) {
    if (value === undefined || value === null) {
        return 'причина не указана';
    }

    try {
        return typeof value === 'string'
            ? value
            : JSON.stringify(value);
    } catch {
        return String(value);
    }
}

function emit(event, data) {
    if (io) {
        io.emit(event, data);
    }
}

function log(message) {
    console.log('[MineCloud]', message);
    emit('log', message);
}

function getStatus() {
    return status;
}

function getInventory() {
    return {
        slots: inventory,
        selected: bot ? bot.quickBarSlot : 0,
        heldItem: bot && bot.heldItem ? {
            name: bot.heldItem.name,
            displayName: bot.heldItem.displayName,
            count: bot.heldItem.count
        } : null
    };
}

function getLookState() {
    return lookState;
}

function updateInventory() {
    if (!bot || !bot.inventory) return;

    inventory = bot.inventory.slots.map((item, slot) => {
        if (!item) return null;

        return {
            slot,
            name: item.name,
            displayName: item.displayName,
            count: item.count
        };
    });

    emit('inventory', getInventory());
}

function closeViewer(target) {
    if (!target || viewerBot !== target) return;

    try {
        if (target.viewer &&
            typeof target.viewer.close === 'function') {
            target.viewer.close();
            log('Viewer закрыт.');
        }
    } catch (error) {
        log('Ошибка закрытия Viewer: ' + error.message);
    }

    viewerStarted = false;
    viewerBot = null;
}

function startViewerForBot(target) {
    if (!target || bot !== target || viewerStarted) return;

    viewerStarted = true;
    viewerBot = target;

    log('Запуск 3D Viewer...');

    try {
        Promise.resolve(startViewer(target, {
            port: VIEWER_PORT,
            firstPerson: true,
            viewDistance: 2
        }))
        .then(() => {
            if (bot === target) {
                log('Viewer запущен на порту ' + VIEWER_PORT);
            }
        })
        .catch(error => {
            viewerStarted = false;
            viewerBot = null;

            log('Ошибка Viewer: ' + (error.stack || error.message));
        });
    } catch (error) {
        viewerStarted = false;
        viewerBot = null;

        log('Ошибка запуска Viewer: ' + (error.stack || error.message));
    }
}

function startBot(options, socketIO) {
    if (starting || bot) {
        log('Бот уже запускается или подключён.');
        return;
    }

    io = socketIO || io;
    options = options || {};

    const host = String(options.host || '').trim();
    const port = Number(options.port);
    const username = String(options.username || 'MineCloud_Bot').trim();

    if (!host || !Number.isInteger(port) ||
        port < 1 || port > 65535) {
        log('Неправильный IP или порт.');
        return;
    }

    starting = true;
    loadedChunks = 0;
    chunkPackets = 0;

    status.online = false;
    status.username = '';
    status.health = 20;
    status.food = 20;

    inventory = [];

    emit('status', status);
    emit('inventory', getInventory());

    log(`Запуск бота: ${host}:${port}`);
    log(`Версия протокола: ${MINECRAFT_VERSION}`);
    log(`Ник: ${username}`);
    log('Подключение к Minecraft...');

    try {
        // ВАЖНО: прямое подключение, без предварительной TCP-проверки
        const newBot = mineflayer.createBot({
            host: host,
            port: port,
            username: username,
            auth: 'offline',
            version: MINECRAFT_VERSION
        });

        bot = newBot;

        newBot._minecloudStage = 'создание соединения';

        connectionTimer = setTimeout(() => {
            if (bot !== newBot || status.online) return;

            log('ВНИМАНИЕ: вход занимает больше 30 секунд.');
            log('Последний этап: ' + newBot._minecloudStage);
        }, 30000);

        // Сетевые события
        if (newBot._client) {
            newBot._client.on('connect', () => {
                if (bot !== newBot) return;

                newBot._minecloudStage = 'TCP соединение установлено';
                log('TCP соединение установлено.');
            });

            newBot._client.on('error', error => {
                if (bot !== newBot) return;

                log('Ошибка сетевого клиента: ' + error.message);
            });

            newBot._client.on('packet', (data, meta) => {
                if (bot !== newBot || !meta) return;

                const packetName = meta.name || '';

                if (/chunk/i.test(packetName)) {
                    chunkPackets++;

                    if (chunkPackets <= 10 || chunkPackets % 20 === 0) {
                        log(`Пакет чанка #${chunkPackets}: ${packetName}`);
                    }
                }
            });
        }

        // Успешная авторизация
        newBot.on('login', () => {
            if (bot !== newBot) return;

            newBot._minecloudStage = 'login выполнен';

            starting = false;

            status.online = true;
            status.username = username;

            if (connectionTimer) {
                clearTimeout(connectionTimer);
                connectionTimer = null;
            }

            emit('status', status);

            log('УСПЕХ: бот вошёл на сервер!');
        });

        // Появление в мире
        newBot.once('spawn', () => {
            if (bot !== newBot) return;

            newBot._minecloudStage = 'spawn выполнен';

            log('Бот появился в мире!');
            log('Обновление инвентаря...');

            updateInventory();

            log('Запускаю Viewer...');
            startViewerForBot(newBot);
        });

        // Загрузка чанков
        newBot.on('chunkColumnLoad', point => {
            if (bot !== newBot) return;

            loadedChunks++;

            if (loadedChunks <= 10 || loadedChunks % 20 === 0) {
                log(
                    `Загружен чанк #${loadedChunks}: X=${point.x}, Z=${point.z}`
                );
            }
        });

        newBot.on('chunkColumnUnload', point => {
            if (bot !== newBot) return;

            log(`Выгружен чанк: X=${point.x}, Z=${point.z}`);
        });

        // Здоровье и голод
        newBot.on('health', () => {
            if (bot !== newBot) return;

            status.health = newBot.health;
            status.food = newBot.food;

            emit('status', status);
        });

        // Инвентарь
        newBot.on('inventoryUpdate', () => {
            if (bot === newBot) {
                updateInventory();
            }
        });

        newBot.on('heldItemChanged', () => {
            if (bot === newBot) {
                updateInventory();
            }
        });

        // Положение и поворот
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

        // Ошибки и отключение
        newBot.on('kicked', reason => {
            if (bot !== newBot) return;

            log('СЕРВЕР ОТКЛОНИЛ БОТА: ' + stringify(reason));
        });

        newBot.on('error', error => {
            if (bot !== newBot) return;

            log('ОШИБКА MINEFLAYER: ' + (error.stack || error.message));
        });

        newBot.once('end', reason => {
            if (connectionTimer) {
                clearTimeout(connectionTimer);
                connectionTimer = null;
            }

            log('Соединение завершено: ' + stringify(reason));

            log(
                `Статистика: чанков=${loadedChunks}, пакетов=${chunkPackets}`
            );

            closeViewer(newBot);

            if (bot === newBot) {
                bot = null;
            }

            starting = false;

            status.online = false;
            status.username = '';

            inventory = [];

            emit('status', status);
            emit('inventory', getInventory());

            log('Бот отключился.');
        });

    } catch (error) {
        if (connectionTimer) {
            clearTimeout(connectionTimer);
            connectionTimer = null;
        }

        bot = null;
        starting = false;

        log('ОШИБКА СОЗДАНИЯ БОТА: ' + (error.stack || error.message));
    }
}

function stopBot() {
    const oldBot = bot;

    bot = null;
    starting = false;

    if (connectionTimer) {
        clearTimeout(connectionTimer);
        connectionTimer = null;
    }

    if (!oldBot) {
        status.online = false;
        status.username = '';
        inventory = [];

        emit('status', status);
        emit('inventory', getInventory());

        log('Бот уже остановлен.');
        return;
    }

    closeViewer(oldBot);

    status.online = false;
    status.username = '';
    inventory = [];

    emit('status', status);
    emit('inventory', getInventory());

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

    if (!block) return;

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

    if (entity) {
        bot.attack(entity);
    }
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

