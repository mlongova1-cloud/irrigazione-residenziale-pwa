const STORAGE_KEY = 'idrohome_state_v1';
const DAYS = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];

const defaultState = {
  rainSensorActive: false,
  rainHoldUntil: null, // timestamp ms
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
    days: [0, 2, 4] // Lun, Mer, Ven
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
    return saved ? { ...defaultState, ...JSON.parse(saved) } : structuredClone(defaultState);
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

// Avvia una o più zone in sequenza (mai in parallelo)
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

  // Watchdog di sicurezza: massimo 60 minuti per zona
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

// Tick simulatore (ogni 1000 ms reali avanza di simSpeed secondi)
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
    stateLabel.textContent = `In corso: ${activeZone.name}`;
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

  // Stato pioggia
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

  // Lista zone
  const zonesList = document.getElementById('zones-list');
  zonesList.innerHTML = '';
  state.zones.forEach((zone) => {
    const isRunning = runtime.activeZoneId === zone.id;
    const isQueued = runtime.queue.includes(zone.id);

    const item = document.createElement('div');
    item.className = `zone-item ${isRunning ? 'active' : ''} ${isQueued ? 'queued' : ''}`;
    item.innerHTML = `
      <div>
        <strong>${zone.name}</strong>
        <div class="zone-meta">
          <span class="muted small">Durata (min):</span>
          <input type="number" min="1" max="60" value="${zone.durationMinutes}" class="duration-input" data-zone="${zone.id}" />
          ${isRunning ? '<span class="pill">APERTA</span>' : ''}
          ${isQueued ? '<span class="pill">IN CODA</span>' : ''}
        </div>
      </div>
      <button class="btn btn-sm ${isRunning ? 'btn-danger' : 'btn-primary'}" data-run-zone="${zone.id}">
        ${isRunning ? 'Ferma' : 'Avvia'}
      </button>
    `;
    zonesList.appendChild(item);
  });

  // Giorni programma
  const daysSelector = document.getElementById('days-selector');
  daysSelector.innerHTML = '';
  DAYS.forEach((day, idx) => {
    const btn = document.createElement('button');
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

  // Velocità simulatore & Log
  document.getElementById('btn-speed').textContent = `Velocità: ${state.simSpeed}x`;
  const logBox = document.getElementById('event-log');
  logBox.innerHTML = runtime.logs.map((l) => `<div>${l}</div>`).join('');
}

// Event Listeners
document.getElementById('btn-run-all').onclick = () => {
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
  const zoneId = e.target.dataset.runZone;
  if (!zoneId) return;
  if (runtime.activeZoneId === zoneId) {
    stopAll(true);
  } else {
    startZones([zoneId], true);
  }
});

document.getElementById('zones-list').addEventListener('change', (e) => {
  const zoneId = e.target.dataset.zone;
  if (!zoneId) return;
  const val = Math.max(1, Math.min(60, Number(e.target.value) || 1));
  const zone = state.zones.find((z) => z.id === zoneId);
  if (zone) {
    zone.durationMinutes = val;
    saveState();
    addLog(`Durata ${zone.name} aggiornata a ${val} min.`);
    render();
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

// Registrazione Service Worker + Avvio
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

addLog('Sistema pronto in modalità simulazione.');
render();