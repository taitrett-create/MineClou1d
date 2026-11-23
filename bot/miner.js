const mineflayer = require('@wp2508/mineflayer');
const { mineflayer: startViewer } = require('prismarine-viewer');
const Vec3 = require('vec3');

let bot = null;
let state = 'offline';
let message = 'Бот не запущен';
let viewerStarted = false;

const allowedControls = [
    'forward',
    'back',
    'left',
    'right',
    'jump',
    'sprint',
    'sneak'
];

const mousePressed = {
    left: false,
    right: false
};

const mouseLoops = {
    left: false,
    right: false
};

let lastMouseError = 0;

function log(io, text) {
    const entry = `[${new Date().toLocaleTimeString()}] ${text}`;

    console.log('[MineCloud]', entry);

    if (io) io.emit('log', entry);
}

function update(io, newState, newMessage) {
    state = newState;
    message = newMessage;

    log(io, newMessage);

    if (io) {
        io.emit('status', {
            online: state === 'online',
            state,
            message
        });
    }
}

function getStatus() {
    return {
        online: state === 'online',
        state,
        message
    };
}

function getLookState() {
    if (!bot || !bot.entity) return null;

    return {
        yaw: bot.entity.yaw,
        pitch: bot.entity.pitch
    };
}

function getVitals() {
    if (!bot || state !== 'online') {
        return {
            health: 0,
            food: 0,
            maxHealth: 20,
            maxFood: 20
        };
    }

    return {
        health: Number(bot.health) || 0,
        food: Number(bot.food) || 0,
        maxHealth: 20,
        maxFood: 20
    };
}

function sendVitals(io) {
    if (io) io.emit('vitals', getVitals());
}

function getInventory() {
    if (!bot || !bot.inventory) {
        return {
            slots: [],
            selected: 0,
            heldItem: null
        };
    }

    const slots = bot.inventory.slots.map((item, slot) => {
        if (!item) return null;

        return {
            slot,
            name: item.name,
            displayName: item.displayName || item.name,
            count: item.count
        };
    });

    const held = bot.heldItem;

    return {
        slots,
        selected: bot.quickBarSlot || 0,
        heldItem: held ? {
            name: held.name,
            displayName: held.displayName || held.name,
            count: held.count
        } : null
    };
}

function sendInventory(io) {
    if (io) io.emit('inventory', getInventory());
}

function closeViewer(currentBot, io) {
    try {
        if (
            currentBot &&
            currentBot.viewer &&
            typeof currentBot.viewer.close === 'function'
        ) {
            currentBot.viewer.close();
            log(io, '3D-просмотрщик остановлен');
        }
    } catch (error) {
        log(io, 'Ошибка закрытия просмотрщика: ' + error.message);
    }

    viewerStarted = false;
}

function releaseMouseActions() {
    mousePressed.left = false;
    mousePressed.right = false;

    if (bot) {
        try {
            bot.stopDigging();
            bot.deactivateItem();
        } catch (error) {}
    }
}

function setMouseAction(button, pressed, io) {
    if (!['left', 'right'].includes(button)) return;
    if (!bot || state !== 'online') return;

    mousePressed[button] = Boolean(pressed);

    if (!pressed && button === 'left') {
        try {
            bot.stopDigging();
        } catch (error) {}
    }

    if (pressed && !mouseLoops[button]) {
        runMouseLoop(button, bot, io);
    }
}

function getTargetEntity(currentBot) {
    try {
        if (typeof currentBot.entityAtCursor === 'function') {
            return currentBot.entityAtCursor(5);
        }
    } catch (error) {}

    return null;
}

function isInteractiveBlock(block) {
    if (!block) return false;

    const name = block.name.toLowerCase();

    return (
        /chest|barrel|shulker_box|furnace|smoker|blast_furnace/.test(name) ||
        /crafting_table|anvil|enchanting_table|brewing_stand/.test(name) ||
        /door|trapdoor|fence_gate|button|lever/.test(name) ||
        /lectern|loom|cartography_table|grindstone|stonecutter/.test(name) ||
        /beehive|bee_nest|note_block|jukebox/.test(name) ||
        /hopper|dispenser|dropper|bell|composter/.test(name)
    );
}

async function leftClick(currentBot) {
    if (!currentBot.entity) return;

    const entity = getTargetEntity(currentBot);

    if (entity && entity !== currentBot.entity) {
        currentBot.attack(entity);

        try {
            currentBot.swingArm('right');
        } catch (error) {}

        await new Promise(resolve => setTimeout(resolve, 450));
        return;
    }

    const block = currentBot.blockAtCursor(5);

    if (!block || block.name === 'air') {
        await new Promise(resolve => setTimeout(resolve, 100));
        return;
    }

    try {
        await currentBot.dig(block);
    } catch (error) {
        // Блок мог исчезнуть или бот мог прекратить копание.
    }
}

async function rightClick(currentBot) {
    if (!currentBot.entity) return;

    const entity = getTargetEntity(currentBot);

    if (entity && entity !== currentBot.entity) {
        try {
            if (typeof currentBot.activateEntity === 'function') {
                await currentBot.activateEntity(entity);
            } else {
                currentBot.activateItem();
            }
        } catch (error) {}

        await new Promise(resolve => setTimeout(resolve, 300));
        return;
    }

    const block = currentBot.blockAtCursor(5);
    const heldItem = currentBot.heldItem;

    if (!block || block.name === 'air') {
        try {
            currentBot.activateItem();
        } catch (error) {}

        await new Promise(resolve => setTimeout(resolve, 300));
        return;
    }

    try {
        // Сундуки, двери, верстаки, кнопки и другие интерактивные блоки.
        if (isInteractiveBlock(block)) {
            await currentBot.activateBlock(block);
        }
        // Если в руке блок — пытаемся поставить его.
        else if (
            heldItem &&
            currentBot.registry &&
            currentBot.registry.blocksByName[heldItem.name]
        ) {
            await currentBot.placeBlock(block, new Vec3(0, 1, 0));
        }
        // Еда, лук, инструменты и прочие предметы.
        else if (heldItem) {
            try {
                await currentBot.activateBlock(block);
            } catch (error) {}

            currentBot.activateItem();
        } else {
            await currentBot.activateBlock(block);
        }

        try {
            currentBot.swingArm('right');
        } catch (error) {}
    } catch (error) {
        // Например, если место установки занято.
    }

    await new Promise(resolve => setTimeout(resolve, 300));
}

async function runMouseLoop(button, currentBot, io) {
    if (mouseLoops[button]) return;

    mouseLoops[button] = true;

    try {
        while (
            bot === currentBot &&
            state === 'online' &&
            mousePressed[button]
        ) {
            try {
                if (button === 'left') {
                    await leftClick(currentBot);
                } else {
                    await rightClick(currentBot);
                }
            } catch (error) {
                const now = Date.now();

                if (now - lastMouseError > 3000) {
                    lastMouseError = now;
                    log(io, 'Ошибка действия мыши: ' + error.message);
                }

                await new Promise(resolve => setTimeout(resolve, 250));
            }
        }
    } finally {
        mouseLoops[button] = false;

        // Если кнопку нажали снова, пока предыдущий цикл завершался.
        if (
            bot === currentBot &&
            state === 'online' &&
            mousePressed[button]
        ) {
            runMouseLoop(button, currentBot, io);
        }
    }
}

function startBot(io, config) {
    if (bot) {
        return {
            success: false,
            message: 'Бот уже подключается или запущен'
        };
    }

    config = config || {};

    const host = String(config.host || '').trim();
    const username = String(config.username || '').trim();
    const port = Number(config.port);

    if (!host || !username) {
        return {
            success: false,
            message: 'Заполни IP и ник'
        };
    }

    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        return {
            success: false,
            message: 'Неправильный порт'
        };
    }

    if (!/^[a-zA-Z0-9_]{3,16}$/.test(username)) {
        return {
            success: false,
            message: 'Неправильный ник'
        };
    }

    update(io, 'connecting', `Подключаемся к ${host}:${port}...`);

    try {
        const currentBot = mineflayer.createBot({
            host,
            port,
            username,
            auth: 'offline',
            version: '26.3'
        });

        bot = currentBot;
        viewerStarted = false;

        mousePressed.left = false;
        mousePressed.right = false;

        currentBot.once('login', () => {
            if (bot !== currentBot) return;

            update(io, 'online', 'Бот вошёл на сервер!');
        });

        currentBot.once('spawn', () => {
            if (bot !== currentBot) return;

            update(io, 'online', 'Бот появился в мире!');

            if (!viewerStarted) {
                viewerStarted = true;

                try {
                    startViewer(currentBot, {
                        port: 3007,
                        firstPerson: true,
                        viewDistance: 6
                    });

                    log(io, '3D-просмотрщик запущен на порту 3007');
                } catch (error) {
                    viewerStarted = false;
                    log(io, 'Ошибка просмотрщика: ' + error.message);
                }
            }

            sendInventory(io);
            sendVitals(io);

            const look = getLookState();
            if (look) io.emit('lookState', look);

            currentBot.inventory.on('updateSlot', () => {
                if (bot === currentBot) sendInventory(io);
            });

            currentBot.on('heldItemChanged', () => {
                if (bot === currentBot) sendInventory(io);
            });

            currentBot.on('health', () => {
                if (bot === currentBot) sendVitals(io);
            });

            currentBot.on('food', () => {
                if (bot === currentBot) sendVitals(io);
            });

            if (typeof currentBot.waitForChunksToLoad === 'function') {
                currentBot.waitForChunksToLoad()
                    .then(() => {
                        if (bot === currentBot) {
                            log(io, 'Чанки Minecraft загружены!');
                        }
                    })
                    .catch(error => {
                        if (bot === currentBot) {
                            log(io, 'Ошибка чанков: ' + error.message);
                        }
                    });
            }
        });

        currentBot.on('kicked', reason => {
            if (bot !== currentBot) return;

            update(io, 'error', 'Сервер отклонил вход: ' + String(reason));
        });

        currentBot.on('error', error => {
            if (bot !== currentBot) return;

            update(io, 'error', 'Ошибка Minecraft: ' + error.message);
        });

        currentBot.once('end', reason => {
            if (bot !== currentBot) return;

            releaseMouseActions();
            closeViewer(currentBot, io);

            bot = null;

            update(
                io,
                'offline',
                'Соединение закрыто: ' + String(reason || '')
            );

            io.emit('inventory', {
                slots: [],
                selected: 0,
                heldItem: null
            });

            sendVitals(io);
        });

        return {
            success: true,
            message: 'Ожидаем подключения к серверу...'
        };
    } catch (error) {
        bot = null;
        viewerStarted = false;

        update(io, 'error', error.message);

        return {
            success: false,
            message: error.message
        };
    }
}

function controlBot(control, pressed) {
    if (!bot || state !== 'online') return;
    if (!allowedControls.includes(control)) return;

    bot.setControlState(control, Boolean(pressed));
}

function lookBot(data) {
    if (!bot || state !== 'online' || !bot.entity || !data) return;

    const yaw = Number(data.yaw);
    const pitch = Number(data.pitch);

    if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) return;

    const safePitch = Math.max(-1.5, Math.min(1.5, pitch));

    bot.look(yaw, safePitch, true);
}

function selectSlot(slot, io) {
    if (!bot || state !== 'online') return;

    const number = Number(slot);

    if (!Number.isInteger(number) || number < 0 || number > 8) return;

    bot.setQuickBarSlot(number);
    sendInventory(io);
}

function releaseControls() {
    if (!bot) return;

    try {
        bot.clearControlStates();
    } catch (error) {
        console.log('Ошибка сброса управления:', error.message);
    }
}

function stopBot(io) {
    if (!bot) {
        update(io, 'offline', 'Бот не подключён');
        return;
    }

    const currentBot = bot;

    releaseMouseActions();
    bot = null;

    update(io, 'stopping', 'Отключаем бота...');

    try {
        currentBot.clearControlStates();
    } catch (error) {}

    closeViewer(currentBot, io);

    try {
        if (typeof currentBot.quit === 'function') {
            currentBot.quit('MineCloud STOP');
        } else if (typeof currentBot.end === 'function') {
            currentBot.end();
        }
    } catch (error) {
        log(io, 'Ошибка отключения: ' + error.message);
    }

    io.emit('inventory', {
        slots: [],
        selected: 0,
        heldItem: null
    });

    io.emit('vitals', {
        health: 0,
        food: 0,
        maxHealth: 20,
        maxFood: 20
    });

    update(io, 'offline', 'Бот остановлен');
}

module.exports = {
    startBot,
    stopBot,
    getStatus,
    getInventory,
    getVitals,
    getLookState,
    controlBot,
    lookBot,
    selectSlot,
    releaseControls,
    setMouseAction,
    releaseMouseActions

};
