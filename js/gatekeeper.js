// ============================================================================
// MyFolioAI - Security Gatekeeper, PIN Crypto & Privacy Masks (gatekeeper.js)
// ============================================================================

let enteredPin = '';
let isSettingUpNewPin = false;
let tempPinForSetup = '';
let lastActiveTimestamp = Date.now();
const AUTO_LOCK_TIMEOUT_MS = 1 * 60 * 1000; // 1 minute

// Default privacy mask states: all 4 key metric cards start masked
let kpiMaskStates = {
  netWorth: true,
  netInvested: true,
  lifetimePnL: true,
  currentFy: true
};

/* ---------------- CRYPTOGRAPHIC HASH (SHA-256) ---------------- */
async function sha256Hex(str) {
  const buf = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/* ---------------- PHYSICAL KEYBOARD LISTENER ---------------- */
function initKeyboardPinListener() {
  window.addEventListener('keydown', (e) => {
    const isSessionUnlocked = sessionStorage.getItem('MYFOLIOAI_UNLOCKED') === 'true';
    if (isSessionUnlocked) return;

    if (e.key >= '0' && e.key <= '9') {
      e.preventDefault();
      pressPinDigit(e.key);
    } else if (e.key === 'Backspace') {
      e.preventDefault();
      backspacePinDigit();
    } else if (e.key === 'Escape' || e.key === 'Delete') {
      e.preventDefault();
      clearPinInput();
    }
  });
}

/* ---------------- 1-MINUTE AUTO-LOCK ENGINE ---------------- */
function resetActivityTimer() {
  lastActiveTimestamp = Date.now();
}

function initAutoLockEngine() {
  ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'].forEach(evt => {
    window.addEventListener(evt, resetActivityTimer, { passive: true });
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && sessionStorage.getItem('MYFOLIOAI_UNLOCKED') === 'true') {
      if (Date.now() - lastActiveTimestamp >= AUTO_LOCK_TIMEOUT_MS) {
        lockApplicationNow();
      }
    }
  });

  setInterval(() => {
    if (sessionStorage.getItem('MYFOLIOAI_UNLOCKED') === 'true') {
      if (Date.now() - lastActiveTimestamp >= AUTO_LOCK_TIMEOUT_MS) {
        lockApplicationNow();
      }
    }
  }, 30000);
}

/* ---------------- GATEKEEPER UI & PIN VERIFICATION ---------------- */
function checkGatekeeperState() {
  const isSessionUnlocked = sessionStorage.getItem('MYFOLIOAI_UNLOCKED') === 'true';
  const overlay = document.getElementById('pinGatekeeperOverlay');
  const root = document.getElementById('app-root');

  if (isSessionUnlocked) {
    if (overlay) overlay.classList.add('hidden');
    if (root) root.style.display = 'flex';
    if (typeof checkPendingMonthEndSnapshot === 'function') {
      checkPendingMonthEndSnapshot();
    }
  } else {
    if (root) root.style.display = 'none';
    if (overlay) overlay.classList.remove('hidden');
    renderPinUI();
  }
}

function renderPinUI() {
  const title = document.getElementById('pinTitle');
  const subtitle = document.getElementById('pinSubtitle');

  if (!appSettings.pinHash) {
    isSettingUpNewPin = true;
    if (title) title.innerText = tempPinForSetup ? 'Confirm New PIN' : 'Create Master PIN';
    if (subtitle) subtitle.innerText = tempPinForSetup ? 'Re-enter your 4-digit PIN to confirm' : 'Set a 4-digit PIN to secure your portfolio';
  } else {
    isSettingUpNewPin = false;
    if (title) title.innerText = 'Security Gatekeeper';
    if (subtitle) subtitle.innerText = 'Enter your PIN to unlock';
  }
  updatePinDots();
}

function updatePinDots() {
  for (let i = 0; i < 4; i++) {
    const dot = document.getElementById(`pinDot-${i}`);
    if (dot) {
      if (i < enteredPin.length) {
        dot.className = 'w-4 h-4 rounded-full bg-emerald-500 border-2 border-emerald-500 scale-110 transition-all duration-150';
      } else {
        dot.className = 'w-4 h-4 rounded-full border-2 border-slate-300 dark:border-gray-600 transition-all duration-150';
      }
    }
  }
}

async function pressPinDigit(digit) {
  if (enteredPin.length >= 4) return;
  enteredPin += digit;
  updatePinDots();

  if (enteredPin.length === 4) {
    await handlePinVerification();
  }
}

function backspacePinDigit() {
  if (enteredPin.length > 0) {
    enteredPin = enteredPin.slice(0, -1);
    updatePinDots();
    hidePinError();
  }
}

function clearPinInput() {
  enteredPin = '';
  updatePinDots();
  hidePinError();
}

function showPinError(msg) {
  const err = document.getElementById('pinStatusMsg');
  const card = document.getElementById('pinCard');
  if (err) {
    err.innerText = msg;
    err.classList.remove('opacity-0');
  }
  if (card) {
    card.classList.add('shake-animation');
    setTimeout(() => {
      card.classList.remove('shake-animation');
    }, 400);
  }
  enteredPin = '';
  updatePinDots();
}

function hidePinError() {
  const err = document.getElementById('pinStatusMsg');
  if (err) err.classList.add('opacity-0');
}

async function handlePinVerification() {
  if (isSettingUpNewPin) {
    if (!tempPinForSetup) {
      tempPinForSetup = enteredPin;
      enteredPin = '';
      renderPinUI();
      return;
    } else {
      if (enteredPin === tempPinForSetup) {
        const hash = await sha256Hex(enteredPin);
        appSettings.pinHash = hash;
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(appSettings));
        
        if (typeof sendToSheet === 'function') {
          sendToSheet({ action: "setPinHash", pinHash: hash });
        }

        tempPinForSetup = '';
        enteredPin = '';
        sessionStorage.setItem('MYFOLIOAI_UNLOCKED', 'true');
        resetActivityTimer();
        resetKpiMasksToDefault();
        checkGatekeeperState();
        if (typeof recalculateAndRender === 'function') recalculateAndRender();
        return;
      } else {
        showPinError('PINs do not match. Restarting setup.');
        tempPinForSetup = '';
        enteredPin = '';
        setTimeout(renderPinUI, 800);
        return;
      }
    }
  }

  const candidateHash = await sha256Hex(enteredPin);
  if (candidateHash === appSettings.pinHash) {
    sessionStorage.setItem('MYFOLIOAI_UNLOCKED', 'true');
    resetActivityTimer();
    enteredPin = '';
    resetKpiMasksToDefault();
    checkGatekeeperState();
    if (typeof recalculateAndRender === 'function') recalculateAndRender();
  } else {
    showPinError('Incorrect PIN. Please re-enter.');
  }
}

function lockApplicationNow() {
  sessionStorage.removeItem('MYFOLIOAI_UNLOCKED');
  enteredPin = '';
  resetKpiMasksToDefault();
  checkGatekeeperState();
}

/* ---------------- GAUSSIAN PRIVACY MASKS ---------------- */
function resetKpiMasksToDefault() {
  kpiMaskStates = {
    netWorth: true,
    netInvested: true,
    lifetimePnL: true,
    currentFy: true
  };
  applyAllKpiMasks();
}

function toggleSingleKpiMask(cardKey) {
  if (kpiMaskStates.hasOwnProperty(cardKey)) {
    kpiMaskStates[cardKey] = !kpiMaskStates[cardKey];
    updateSingleMaskUI(cardKey);
  }
}

function updateSingleMaskUI(cardKey) {
  const isMasked = kpiMaskStates[cardKey];
  const icon = document.getElementById(`maskToggleIcon-${cardKey}`);
  if (icon) {
    icon.setAttribute('data-lucide', isMasked ? 'eye-off' : 'eye');
  }

  const targetsMap = {
    netWorth: ['kpiNetWorth', 'subPortfolioVal', 'subCashVal', 'kpiNetWorthRem'],
    netInvested: ['kpiNetInvested', 'kpiNetInvestedRem'],
    lifetimePnL: ['kpiLifetimePnL', 'kpiLifetimeTargetRem'],
    currentFy: ['kpiCurrentFyPnL', 'kpiCurrentFyUnrealized', 'kpiCurrentFyRem']
  };

  (targetsMap[cardKey] || []).forEach(elemId => {
    const el = document.getElementById(elemId);
    if (el) {
      if (isMasked) el.classList.add('privacy-blurred');
      else el.classList.remove('privacy-blurred');
    }
  });

  if (window.lucide && typeof lucide.createIcons === 'function') {
    lucide.createIcons();
  }
}

function applyAllKpiMasks() {
  ['netWorth', 'netInvested', 'lifetimePnL', 'currentFy'].forEach(key => updateSingleMaskUI(key));
}
