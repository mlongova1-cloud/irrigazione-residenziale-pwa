const STORAGE_KEY = 'idrohome_state_v1';
const DAYS = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];

const defaultState = {
  rainSensorActive: false,
  rainHoldUntil: null,
  simSpeed: 1,
  zones: [
    { id: 'z1', name: 'Prato Fronte', durationMinutes: 15 },
    { id: 'z2', name: 'Prato Retro', durationMinutes: 20 },
    { id: 'z3', name: 'Siepe e Aiuole', durationMinutes: 10 },
    { id: 'z4', name: 'Orto Domestico', durationMinutes: 12 }
  ],
  schedule: {
    enabled: true,
    startTime: '05:30',
    days: [0, 2, 4]
  }
};

let state = loadState();
let runtime = {
  activeZoneId: null,
  remainingSeconds: 0,
  queue: [],
  logs: []
};

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return structuredClone(defaultState);
    const parsed = JSON.parse(saved);
    return {
      ...defaultState,
      ...parsed,
      zones: Array.isArray(parsed.zones) && parsed.zones.length > 0
        ? parsed.zones
        : structuredClone(defaultState.zones),
      schedule: { ...defaultState.schedule, ...(parsed.schedule || {}) }
    };
  } catch {
    return structuredClone(defaultState);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function addLog(message) {
  const time = new Date().toLocaleTimeString('it-IT');
  runtime.logs.unshift(`[${time}] ${message}`);
  runtime.logs = runtime.logs.slice(0, 25);
}

function isRainBlocked() {
  const holdActive = state.rainHoldUntil && Date.now() < state.rainHoldUntil;
  return state.rainSensorActive || holdActive;
}

function formatSeconds(sec) {
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function startZones(zoneIds, manualOverride = false) {
  if (!manualOverride && isRainBlocked()) {
    addLog('Avvio bloccato: sensore pioggia o pausa attiva.');
    render();
    return;
  }

  stopAll(false);
  runtime.queue = [...zoneIds];
  addLog(`Avviata sequenza (${zoneIds.length} zone).`);
  advanceQueue();
}

function advanceQueue() {
  if (runtime.queue.length === 0) {
    runtime.activeZoneId = null;
    runtime.remainingSeconds = 0;
    addLog('Ciclo irrigazione completato.');
    render();
    return;
  }

  const nextId = runtime.queue.shift();
  const zone = state.zones.find((z) => z.id === nextId);
  if (!zone || zone.durationMinutes <= 0) {
    advanceQueue();
    return;
  }

  const safeMinutes = Math.min(zone.durationMinutes, 60);
  runtime.activeZoneId = zone.id;
  runtime.remainingSeconds = safeMinutes * 60;
  addLog(`Aperta elettrovalvola: ${zone.name} (${safeMinutes} min).`);
  render();
}

function stopAll(logEvent = true) {
  if (runtime.activeZoneId || runtime.queue.length > 0) {
    if (logEvent) addLog('STOP emergenza: tutte le elettrovalvole chiuse.');
  }
  runtime.activeZoneId = null;
  runtime.remainingSeconds = 0;
  runtime.queue = [];
  render();
}

function addZone(name, durationMinutes) {
  const cleanName = name.trim();
  if (!cleanName) return;
  const safeDuration = Math.max(1, Math.min(60, Number(durationMinutes) || 10));
  const id = `z_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;
  state.zones.push({ id, name: cleanName, durationMinutes: safeDuration });
  saveState();
  addLog(`Aggiunta zona "${cleanName}" (${safeDuration} min).`);
  render();
}

function renameZone(zoneId, newName) {
  const zone = state.zones.find((z) => z.id === zoneId);
  if (!zone) return;
  const cleanName = newName.trim();
  if (!cleanName || cleanName === zone.name) {
    render();
    return;
  }
  const oldName = zone.name;
  zone.name = cleanName;
  saveState();
  addLog(`Zona rinominata: "${oldName}" → "${cleanName}".`);
  render();
}

function moveZone(zoneId, delta) {
  const idx = state.zones.findIndex((z) => z.id === zoneId);
  if (idx === -1) return;
  const targetIdx = idx + delta;
  if (targetIdx < 0 || targetIdx >= state.zones.length) return;

  const [moved] = state.zones.splice(idx, 1);
  state.zones.splice(targetIdx, 0, moved);
  saveState();
  addLog(`Spostata zona "${moved.name}" in posizione ${targetIdx + 1}.`);
  render();
}

function deleteZone(zoneId) {
  if (runtime.activeZoneId === zoneId) {
    addLog('Impossibile eliminare una zona attualmente aperta: fermala prima.');
    render();
    return;
  }
  const zone = state.zones.find((z) => z.id === zoneId);
  if (!zone) return;

  state.zones = state.zones.filter((z) => z.id !== zoneId);
  runtime.queue = runtime.queue.filter((id) => id !== zoneId);
  saveState();
  addLog(`Eliminata zona "${zone.name}".`);
  render();
}

setInterval(() => {
  if (!runtime.activeZoneId) return;

  runtime.remainingSeconds -= state.simSpeed;
  if (runtime.remainingSeconds <= 0) {
    const finishedZone = state.zones.find((z) => z.id === runtime.activeZoneId);
    if (finishedZone) addLog(`Chiusa elettrovalvola: ${finishedZone.name}.`);
    advanceQueue();
  } else {
    renderStatusOnly();
  }
}, 1000);

function renderStatusOnly() {
  const timerEl = document.getElementById('active-timer');
  timerEl.textContent = formatSeconds(runtime.remainingSeconds);
}

function escapeAttr(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function render() {
  const statusCard = document.querySelector('.status-card');
  const stateLabel = document.getElementById('plant-state-label');
  const stateDetail = document.getElementById('plant-state-detail');
  const timerEl = document.getElementById('active-timer');
  const rainStatus = document.getElementById('rain-status');

  statusCard.classList.remove('running', 'hold');

  if (runtime.activeZoneId) {
    const activeZone = state.zones.find((z) => z.id === runtime.activeZoneId);
    statusCard.classList.add('running');
    stateLabel.textContent = `In corso: ${activeZone ? activeZone.name : 'Zona'}`;
    stateDetail.textContent = runtime.queue.length
      ? `In coda: ${runtime.queue.length} zona/e successive`
      : 'Ultima zona del ciclo in corso';
    timerEl.textContent = formatSeconds(runtime.remainingSeconds);
  } else if (isRainBlocked()) {
    statusCard.classList.add('hold');
    stateLabel.textContent = 'Irrigazione Sospesa';
    stateDetail.textContent = state.rainSensorActive
      ? 'Sensore pioggia attivo: cicli automatici bloccati.'
      : `Pausa manuale fino al ${new Date(state.rainHoldUntil).toLocaleString('it-IT')}`;
    timerEl.textContent = 'HOLD';
  } else {
    stateLabel.textContent = 'A riposo';
    stateDetail.textContent = 'Pronto · Nessuna elettrovalvola aperta.';
    timerEl.textContent = '00:00';
  }

  if (state.rainSensorActive) {
    rainStatus.textContent = 'Pioggia rilevata';
    rainStatus.className = 'pill rain';
  } else if (state.rainHoldUntil && Date.now() < state.rainHoldUntil) {
    rainStatus.textContent = 'Pausa attiva';
    rainStatus.className = 'pill rain';
  } else {
    rainStatus.textContent = 'Asciutto';
    rainStatus.className = 'pill';
  }

  const zonesList = document.getElementById('zones-list');
  zonesList.innerHTML = '';

  if (state.zones.length === 0) {
    zonesList.innerHTML = '<p class="muted small">Nessuna zona configurata. Aggiungine una qui sopra.</p>';
  }

  state.zones.forEach((zone, index) => {
    const isRunning = runtime.activeZoneId === zone.id;
    const isQueued = runtime.queue.includes(zone.id);

    const item = document.createElement('div');
    item.className = `zone-item ${isRunning ? 'active' : ''} ${isQueued ? 'queued' : ''}`;
    item.innerHTML = `
      <div class="zone-left">
        <input
          type="text"
          class="zone-name-input"
          value="${escapeAttr(zone.name)}"
          data-rename-zone="${zone.id}"
          aria-label="Nome zona ${escapeAttr(zone.name)}"
        />
        <div class="zone-meta">
          <span class="muted small">Min:</span>
          <input
            type="number"
            min="1"
            max="60"
            value="${zone.durationMinutes}"
            class="duration-input"
            data-zone="${zone.id}"
          />
          ${isRunning ? '<span class="pill">APERTA</span>' : ''}
          ${isQueued ? '<span class="pill">IN CODA</span>' : ''}
        </div>
      </div>
      <div class="zone-actions">
        <button
          type="button"
          class="btn-icon"
          data-move-up="${zone.id}"
          title="Sposta su"
          ${index === 0 ? 'disabled' : ''}
        >▲</button>
        <button
          type="button"
          class="btn-icon"
          data-move-down="${zone.id}"
          title="Sposta giù"
          ${index === state.zones.length - 1 ? 'disabled' : ''}
        >▼</button>
        <button
          type="button"
          class="btn btn-sm ${isRunning ? 'btn-danger' : 'btn-primary'}"
          data-run-zone="${zone.id}"
        >
          ${isRunning ? 'Ferma' : 'Avvia'}
        </button>
        <button
          type="button"
          class="btn-icon btn-del"
          data-delete-zone="${zone.id}"
          title="Elimina zona"
        >✕</button>
      </div>
    `;
    zonesList.appendChild(item);
  });

  document.getElementById('schedule-enabled').checked = Boolean(state.schedule.enabled);
  document.getElementById('schedule-time').value = state.schedule.startTime || '05:30';

  const daysSelector = document.getElementById('days-selector');
  daysSelector.innerHTML = '';
  DAYS.forEach((day, idx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `day-btn ${state.schedule.days.includes(idx) ? 'active' : ''}`;
    btn.textContent = day;
    btn.onclick = () => {
      if (state.schedule.days.includes(idx)) {
        state.schedule.days = state.schedule.days.filter((d) => d !== idx);
      } else {
        state.schedule.days.push(idx);
      }
      saveState();
      render();
    };
    daysSelector.appendChild(btn);
  });

  document.getElementById('btn-speed').textContent = `Velocità: ${state.simSpeed}x`;
  const logBox = document.getElementById('event-log');
  logBox.innerHTML = runtime.logs.map((l) => `<div>${l}</div>`).join('');
}

// Event Listeners
document.getElementById('add-zone-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const nameInput = document.getElementById('new-zone-name');
  const durInput = document.getElementById('new-zone-duration');
  addZone(nameInput.value, durInput.value);
  nameInput.value = '';
  nameInput.focus();
});

document.getElementById('btn-run-all').onclick = () => {
  if (state.zones.length === 0) return;
  startZones(state.zones.map((z) => z.id), true);
};

document.getElementById('btn-stop-all').onclick = () => stopAll(true);

document.getElementById('btn-toggle-rain').onclick = () => {
  state.rainSensorActive = !state.rainSensorActive;
  addLog(`Sensore pioggia simulato: ${state.rainSensorActive ? 'ATTIVO' : 'DISATTIVO'}.`);
  if (state.rainSensorActive && runtime.activeZoneId) {
    stopAll(false);
    addLog('Ciclo interrotto automaticamente per rilevamento pioggia.');
  }
  saveState();
  render();
};

document.querySelectorAll('[data-hold]').forEach((btn) => {
  btn.onclick = () => {
    const hours = Number(btn.dataset.hold);
    state.rainHoldUntil = hours > 0 ? Date.now() + hours * 3600 * 1000 : null;
    addLog(hours > 0 ? `Impostata pausa irrigazione per ${hours} ore.` : 'Pausa irrigazione rimossa.');
    saveState();
    render();
  };
});

document.getElementById('zones-list').addEventListener('click', (e) => {
  const runId = e.target.dataset.runZone;
  if (runId) {
    if (runtime.activeZoneId === runId) {
      stopAll(true);
    } else {
      startZones([runId], true);
    }
    return;
  }

  const upId = e.target.dataset.moveUp;
  if (upId) {
    moveZone(upId, -1);
    return;
  }

  const downId = e.target.dataset.moveDown;
  if (downId) {
    moveZone(downId, 1);
    return;
  }

  const delId = e.target.dataset.deleteZone;
  if (delId) {
    deleteZone(delId);
  }
});

document.getElementById('zones-list').addEventListener('change', (e) => {
  const durZoneId = e.target.dataset.zone;
  if (durZoneId) {
    const val = Math.max(1, Math.min(60, Number(e.target.value) || 1));
    const zone = state.zones.find((z) => z.id === durZoneId);
    if (zone) {
      zone.durationMinutes = val;
      saveState();
      addLog(`Durata ${zone.name} aggiornata a ${val} min.`);
      render();
    }
    return;
  }

  const renameZoneId = e.target.dataset.renameZone;
  if (renameZoneId) {
    renameZone(renameZoneId, e.target.value);
  }
});

document.getElementById('schedule-enabled').onchange = (e) => {
  state.schedule.enabled = e.target.checked;
  saveState();
  addLog(`Programma automatico ${state.schedule.enabled ? 'attivato' : 'disattivato'}.`);
  render();
};

document.getElementById('schedule-time').onchange = (e) => {
  state.schedule.startTime = e.target.value;
  saveState();
  addLog(`Orario programma impostato alle ${e.target.value}.`);
  render();
};

document.getElementById('btn-speed').onclick = () => {
  state.simSpeed = state.simSpeed === 1 ? 10 : 1;
  saveState();
  render();
};

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

addLog('Sistema pronto con gestione dinamica zone.');
render();
