
const socket = io();

const statusElement = document.getElementById('status');
const messageElement = document.getElementById('message');
const logList = document.getElementById('logList');

const startButton = document.getElementById('start');
const stopButton = document.getElementById('stop');

const mouseLayer = document.getElementById('mouseLayer');
const screenHint = document.getElementById('screenHint');

const hotbar = document.getElementById('hotbar');
const inventoryGrid = document.getElementById('inventoryGrid');

const healthBar = document.getElementById('healthBar');
const foodBar = document.getElementById('foodBar');
const healthText = document.getElementById('healthText');
const foodText = document.getElementById('foodText');

const heldItemName = document.getElementById('heldItemName');
const heldItemCount = document.getElementById('heldItemCount');

let yaw = 0;
let pitch = 0;

const pressedKeys = new Set();

const mouseHeld = {
    left: false,
    right: false
};

const mouseToggle = {
    left: false,
    right: false
};

const mouseSent = {
    left: false,
    right: false
};

const mouseTimers = {
    left: null,
    right: null
};

const keyControls = {
    KeyW: 'forward',
    KeyS: 'back',
    KeyA: 'left',
    KeyD: 'right',
    Space: 'jump',
    ShiftLeft: 'sneak',
    ShiftRight: 'sneak',
    ControlLeft: 'sprint',
    ControlRight: 'sprint'
};

function addLog(message) {
    if (!logList) return;

    const entry = document.createElement('p');

    entry.textContent =
        `[${new Date().toLocaleTimeString()}] ${message}`;

    logList.prepend(entry);

    while (logList.children.length > 40) {
        logList.lastElementChild.remove();
    }
}

function updateHint() {
    if (!screenHint) return;

    const locked = document.pointerLockElement === mouseLayer;

    const leftText = mouseToggle.left ? 'F9: ЛКМ ВКЛ' : '';
    const rightText = mouseToggle.right ? 'F8: ПКМ ВКЛ' : '';

    const modes = [leftText, rightText].filter(Boolean).join(' · ');

    if (locked) {
        screenHint.textContent =
            'Мышь захвачена · Esc — отпустить' +
            (modes ? ' · ' + modes : '');
    } else {
        screenHint.textContent =
            'Нажми на экран, чтобы управлять камерой' +
            (modes ? ' · ' + modes : '');
    }
}

function updateVitals(data) {
    if (!data) return;

    const health = Math.max(
        0,
        Math.min(20, Number(data.health) || 0)
    );

    const food = Math.max(
        0,
        Math.min(20, Number(data.food) || 0)
    );

    if (healthBar) healthBar.style.width = `${health * 5}%`;
    if (foodBar) foodBar.style.width = `${food * 5}%`;

    if (healthText) healthText.textContent = `${health}/20`;
    if (foodText) foodText.textContent = `${food}/20`;
}

function sendMouseAction(button) {
    if (button === 'left') {
        socket.emit('breakBlock');
    } else {
        socket.emit('placeBlock');
    }
}

function syncMouse(button) {
    const active = mouseHeld[button] || mouseToggle[button];

    if (active === mouseSent[button]) return;

    mouseSent[button] = active;

    if (active) {
        sendMouseAction(button);

        mouseTimers[button] = setInterval(() => {
            if (mouseHeld[button] || mouseToggle[button]) {
                sendMouseAction(button);
            }
        }, 350);
    } else {
        if (mouseTimers[button]) {
            clearInterval(mouseTimers[button]);
            mouseTimers[button] = null;
        }
    }
}

function releaseAllMouse() {
    mouseHeld.left = false;
    mouseHeld.right = false;

    mouseToggle.left = false;
    mouseToggle.right = false;

    syncMouse('left');
    syncMouse('right');

    updateHint();
}

function releaseAllKeys() {
    for (const code of pressedKeys) {
        const control = keyControls[code];

        if (control) {
            socket.emit('move', {
                direction: control,
                enabled: false
            });
        }
    }

    pressedKeys.clear();
}

function pressKey(event) {
    const control = keyControls[event.code];

    if (!control || pressedKeys.has(event.code)) return;

    event.preventDefault();
    pressedKeys.add(event.code);

    socket.emit('move', {
        direction: control,
        enabled: true
    });
}

function releaseKey(event) {
    const control = keyControls[event.code];

    if (!control || !pressedKeys.has(event.code)) return;

    event.preventDefault();
    pressedKeys.delete(event.code);

    socket.emit('move', {
        direction: control,
        enabled: false
    });
}

function selectHotbar(slot) {
    if (!hotbar) return;

    hotbar.querySelectorAll('.itemSlot[data-hotbar]').forEach(element => {
        element.classList.toggle(
            'selected',
            Number(element.dataset.hotbar) === slot
        );
    });
}

function createSlot(item, slot, isHotbar) {
    const element = document.createElement('div');

    element.className = 'itemSlot';

    if (item) {
        element.title =
            `${item.displayName || item.name} × ${item.count}`;

        const name = document.createElement('span');
        name.className = 'itemName';
        name.textContent = item.displayName || item.name;

        const count = document.createElement('span');
        count.className = 'itemCount';
        count.textContent = item.count;

        element.append(name, count);
    } else {
        element.title = 'Пустой слот';
    }

    if (isHotbar) {
        element.dataset.hotbar = slot;
    }

    return element;
}

function renderInventory(data) {
    if (!data || !hotbar || !inventoryGrid) return;

    const slots = Array.isArray(data)
        ? data
        : (data.slots || []);

    hotbar.innerHTML = '';
    inventoryGrid.innerHTML = '';

    // Хотбар: слоты 36–44
    for (let i = 0; i < 9; i++) {
        hotbar.appendChild(
            createSlot(slots[i + 36] || null, i, true)
        );
    }

    // Основной инвентарь: слоты 9–35
    for (let i = 9; i < 36; i++) {
        inventoryGrid.appendChild(
            createSlot(slots[i] || null, i, false)
        );
    }

    // Броня и дополнительные слоты
    for (let i = 5; i < 9; i++) {
        if (slots[i]) {
            inventoryGrid.appendChild(
                createSlot(slots[i], i, false)
            );
        }
    }

    const selected = Number(data.selected ?? 0);

    selectHotbar(selected);

    const held = data.heldItem ||
        slots[36 + selected] ||
        null;

    if (held) {
        heldItemName.textContent =
            held.displayName || held.name;

        heldItemCount.textContent = `×${held.count}`;
    } else {
        heldItemName.textContent = 'Пустая рука';
        heldItemCount.textContent = '';
    }
}

// Socket.IO
socket.on('connect', () => {
    addLog('Соединение с MineCloud установлено');
});

socket.on('connect_error', error => {
    addLog('Ошибка сайта: ' + error.message);
});

socket.on('disconnect', reason => {
    addLog('Соединение с сайтом потеряно');

    releaseAllKeys();
    releaseAllMouse();
});

socket.on('log', addLog);

socket.on('status', data => {
    if (!data) return;

    statusElement.textContent =
        data.online ? '● ONLINE' : '● OFFLINE';

    statusElement.style.color =
        data.online ? '#22c55e' : '#ff5555';

    updateVitals(data);

    if (data.message) {
        messageElement.textContent = data.message;
    }
});

socket.on('vitals', updateVitals);

socket.on('actionResult', data => {
    if (!data) return;

    messageElement.textContent = data.message;
    addLog(data.message);
});

socket.on('look', data => {
    if (!data) return;

    if (Number.isFinite(data.yaw)) yaw = data.yaw;
    if (Number.isFinite(data.pitch)) pitch = data.pitch;
});

socket.on('lookState', data => {
    if (!data) return;

    if (Number.isFinite(data.yaw)) yaw = data.yaw;
    if (Number.isFinite(data.pitch)) pitch = data.pitch;
});

socket.on('inventory', renderInventory);

// Запуск бота
startButton.addEventListener('click', () => {
    const config = {
        host: document.getElementById('host').value.trim(),
        port: document.getElementById('port').value,
        username: document.getElementById('username').value.trim()
    };

    if (!config.host || !config.username || !config.port) {
        messageElement.textContent = 'Заполни IP, порт и ник';
        return;
    }

    socket.emit('startBot', config);
    addLog('Отправлена команда START');
});

// Остановка бота
stopButton.addEventListener('click', () => {
    releaseAllKeys();
    releaseAllMouse();

    socket.emit('stopBot');

    addLog('Отправлена команда STOP');
});

// Клавиатура
document.addEventListener('keydown', event => {
    if (event.code === 'F8' || event.code === 'F9') {
        event.preventDefault();

        if (event.repeat) return;

        if (event.code === 'F8') {
            mouseToggle.right = !mouseToggle.right;
            syncMouse('right');

            addLog(
                mouseToggle.right
                    ? 'Бесконечный ПКМ включён'
                    : 'Бесконечный ПКМ выключен'
            );
        }

        if (event.code === 'F9') {
            mouseToggle.left = !mouseToggle.left;
            syncMouse('left');

            addLog(
                mouseToggle.left
                    ? 'Бесконечный ЛКМ включён'
                    : 'Бесконечный ЛКМ выключен'
            );
        }

        updateHint();
        return;
    }

    if (/^[1-9]$/.test(event.key)) {
        const slot = Number(event.key) - 1;

        socket.emit('selectSlot', slot);
        selectHotbar(slot);

        return;
    }

    pressKey(event);
});

document.addEventListener('keyup', releaseKey);

window.addEventListener('blur', () => {
    releaseAllKeys();

    mouseHeld.left = false;
    mouseHeld.right = false;

    syncMouse('left');
    syncMouse('right');
});

document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        releaseAllKeys();

        mouseHeld.left = false;
        mouseHeld.right = false;

        syncMouse('left');
        syncMouse('right');
    }
});

// Мышь и камера
mouseLayer.addEventListener('mousedown', event => {
    if (event.button !== 0 && event.button !== 2) return;

    event.preventDefault();

    if (document.pointerLockElement !== mouseLayer) {
        mouseLayer.requestPointerLock();
    }

    const button = event.button === 0 ? 'left' : 'right';

    mouseHeld[button] = true;
    syncMouse(button);
});

document.addEventListener('mouseup', event => {
    if (event.button !== 0 && event.button !== 2) return;

    const button = event.button === 0 ? 'left' : 'right';

    mouseHeld[button] = false;
    syncMouse(button);
});

mouseLayer.addEventListener('contextmenu', event => {
    event.preventDefault();
});

document.addEventListener('pointerlockchange', updateHint);

document.addEventListener('mousemove', event => {
    if (document.pointerLockElement !== mouseLayer) return;

    yaw -= event.movementX * 0.0025;
    pitch -= event.movementY * 0.0025;

    pitch = Math.max(-1.5, Math.min(1.5, pitch));

    socket.emit('look', {
        yaw,
        pitch
    });
});

updateHint();
