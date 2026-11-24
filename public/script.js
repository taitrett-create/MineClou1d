
const socket = io();

const statusElement = document.getElementById('status');
const messageElement = document.getElementById('message');
const logList = document.getElementById('logList');

const startButton = document.getElementById('start');
const stopButton = document.getElementById('stop');

const mouseLayer = document.getElementById('mouseLayer');
const screenHint = document.getElementById('screenHint');
const viewerFrame = document.getElementById('viewer');

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
let viewerLoaded = false;

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
    const entry = document.createElement('p');

    entry.textContent =
        `[${new Date().toLocaleTimeString()}] ${message}`;

    logList.prepend(entry);

    while (logList.children.length > 40) {
        logList.lastElementChild.remove();
    }
}

function loadViewer() {
    if (viewerLoaded) return;

    viewerLoaded = true;

    addLog('Открываем 3D-просмотрщик Minecraft...');

    viewerFrame.src = '/viewer/';

    messageElement.textContent = 'Загружаем 3D-мир Minecraft...';
}

function syncMouse(button) {
    const active =
        mouseHeld[button] || mouseToggle[button];

    if (active === mouseSent[button]) return;

    mouseSent[button] = active;

    socket.emit('mouseAction', {
        button,
        pressed: active
    });
}

function releaseAllMouse() {
    mouseHeld.left = false;
    mouseHeld.right = false;

    mouseToggle.left = false;
    mouseToggle.right = false;

    mouseSent.left = false;
    mouseSent.right = false;

    socket.emit('releaseMouse');

    updateHint();
}

function updateHint() {
    const locked =
        document.pointerLockElement === mouseLayer;

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

socket.on('connect', () => {
    addLog('Соединение с MineCloud установлено');
});

socket.on('connect_error', error => {
    addLog('Ошибка сайта: ' + error.message);
});

socket.on('disconnect', () => {
    addLog('Соединение с сайтом потеряно');

    releaseAllKeys();
    releaseAllMouse();
});

socket.on('status', data => {
    statusElement.textContent =
        data.online ? '● ONLINE' : '● OFFLINE';

    statusElement.style.color =
        data.online ? '#22c55e' : '#ff5555';

    messageElement.textContent = data.message;

    if (data.state === 'offline' || data.state === 'error') {
        viewerLoaded = false;
        viewerFrame.src = 'about:blank';
    }
});

socket.on('log', addLog);

socket.on('actionResult', data => {
    messageElement.textContent = data.message;
    addLog(data.message);
});

// Сервер сообщает, что локальный просмотрщик действительно запущен.
socket.on('viewerReady', () => {
    loadViewer();
});

socket.on('lookState', data => {
    if (Number.isFinite(data.yaw)) yaw = data.yaw;
    if (Number.isFinite(data.pitch)) pitch = data.pitch;
});

socket.on('vitals', data => {
    const health = Math.max(
        0,
        Math.min(20, Number(data.health) || 0)
    );

    const food = Math.max(
        0,
        Math.min(20, Number(data.food) || 0)
    );

    healthBar.style.width = `${health / 20 * 100}%`;
    foodBar.style.width = `${food / 20 * 100}%`;

    healthText.textContent = `${health}/20`;
    foodText.textContent = `${food}/20`;
});

socket.on('inventory', renderInventory);

// Запуск бота
startButton.addEventListener('click', () => {
    const config = {
        host: document.getElementById('host').value.trim(),
        port: document.getElementById('port').value,
        username: document.getElementById('username').value.trim()
    };

    if (!config.host || !config.username) {
        messageElement.textContent = 'Заполни IP и ник';
        return;
    }

    viewerLoaded = false;
    viewerFrame.src = 'about:blank';

    socket.emit('startBot', config);
    addLog('Отправлена команда START');
});

// Остановка бота
stopButton.addEventListener('click', () => {
    releaseAllKeys();
    releaseAllMouse();

    viewerLoaded = false;
    viewerFrame.src = 'about:blank';

    socket.emit('stopBot');

    addLog('Отправлена команда STOP');
});

// Клавиатура
function pressKey(event) {
    const control = keyControls[event.code];

    if (!control || pressedKeys.has(event.code)) return;

    event.preventDefault();
    pressedKeys.add(event.code);

    socket.emit('control', {
        control,
        pressed: true
    });
}

function releaseKey(event) {
    const control = keyControls[event.code];

    if (!control || !pressedKeys.has(event.code)) return;

    event.preventDefault();
    pressedKeys.delete(event.code);

    socket.emit('control', {
        control,
        pressed: false
    });
}

function releaseAllKeys() {
    for (const code of pressedKeys) {
        const control = keyControls[code];

        if (control) {
            socket.emit('control', {
                control,
                pressed: false
            });
        }
    }

    pressedKeys.clear();
}

// Выбор слота и F8/F9
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

// Захват мыши и поворот камеры
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

document.addEventListener('pointerlockchange', () => {
    updateHint();
});

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

// Инвентарь
function renderInventory(data) {
    const slots = data.slots || [];

    hotbar.innerHTML = '';
    inventoryGrid.innerHTML = '';

    for (let i = 0; i < 9; i++) {
        const item = slots[i + 36] || null;

        hotbar.appendChild(createSlot(item, i, true));
    }

    for (let i = 9; i < 36; i++) {
        const item = slots[i] || null;

        inventoryGrid.appendChild(createSlot(item, i, false));
    }

    for (let i = 5; i < 9; i++) {
        const item = slots[i] || null;

        if (item) {
            inventoryGrid.appendChild(createSlot(item, i, false));
        }
    }

    selectHotbar(data.selected || 0);

    const held = data.heldItem;

    if (held) {
        heldItemName.textContent = held.displayName;
        heldItemCount.textContent = `×${held.count}`;
    } else {
        heldItemName.textContent = 'Пустая рука';
        heldItemCount.textContent = '';
    }
}

function createSlot(item, slot, isHotbar) {
    const element = document.createElement('div');

    element.className = 'itemSlot';

    if (item) {
        element.title =
            `${item.displayName} × ${item.count}`;

        const name = document.createElement('span');

        name.className = 'itemName';
        name.textContent = item.displayName;

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

function selectHotbar(slot) {
    document.querySelectorAll('.itemSlot[data-hotbar]').forEach(element => {
        element.classList.toggle(
            'selected',
            Number(element.dataset.hotbar) === slot
        );
    });
}

updateHint();
