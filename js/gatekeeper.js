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

    // Do not intercept if user is typing into an input field on the link overlay
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;

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
  const card = document.getElementById('pinCard');
  if (!card) return;

  // Check if Google Sheet URL is configured. If NOT linked yet, display the Sheet Link Screen first.
  const isSheetLinked = cloudScriptUrl && cloudScriptUrl.trim() !== '';

  if (!isSheetLinked && !appSettings.pinHash) {
    renderSheetLinkOverlay(card);
    return;
  }

  // Standard PIN screen layout template restoration if sheet is linked or pin exists
  renderStandardPinLayout(card);
}

function renderSheetLinkOverlay(container) {
  container.innerHTML = `
    <div class="flex flex-col items-center space-y-2">
      <div class="h-14 w-14 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-500/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shadow-sm">
        <i data-lucide="cloud-cog" class="w-7 h-7"></i>
      </div>
      <h2 class="text-xl font-extrabold tracking-tight text-slate-900 dark:text-white">Link Your Google Sheet</h2>
      <p class="text-xs text-slate-500 dark:text-slate-400">Connect your existing cloud database to securely load your profile &amp; PIN</p>
    </div>

    <div class="space-y-3 text-left text-xs pt-1">
      <div>
        <label class="block text-slate-600 dark:text-slate-300 font-semibold mb-1">Web App Deployment URL</label>
        <input type="text" id="gatekeeperScriptUrl" placeholder="https://script.google.com/macros/s/..." class="w-full bg-slate-100 dark:bg-[#1A1F2E] border border-slate-300 dark:border-[#222836] rounded-xl p-2.5 text-slate-900 dark:text-white mono-font text-xs focus:outline-none focus:border-emerald-500">
      </div>
      <div>
        <label class="block text-slate-600 dark:text-slate-300 font-semibold mb-1">API Secret Token (Handshake)</label>
        <input type="password" id="gatekeeperApiToken" placeholder="Enter matching API_SECRET key" class="w-full bg-slate-100 dark:bg-[#1A1F2E] border border-slate-300 dark:border-[#222836] rounded-xl p-2.5 text-slate-900 dark:text-white mono-font text-xs focus:outline-none focus:border-emerald-500">
      </div>
      <div id="gatekeeperLinkMsg" class="text-xs font-semibold h-4 text-rose-500 opacity-0 transition-opacity text-center"></div>
    </div>

    <div class="pt-2">
      <button onclick="handleGatekeeperSheetLink()" class="w-full py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-gray-950 font-extrabold text-xs shadow-md transition active:scale-95">
        Connect &amp; Sync Portfolio
      </button>
    </div>

    <div class="text-[11px] text-slate-400 dark:text-slate-500 pt-2 border-t border-slate-100 dark:border-[#222836] text-center">
      New user? <button onclick="bypassToPinCreation()" class="text-emerald-600 dark:text-emerald-400 font-bold hover:underline">Create a new PIN instead</button>
    </div>
  `;

  if (window.lucide) lucide.createIcons();
}

function bypassToPinCreation() {
  appSettings.pinHash = 'TEMP_FLAG'; // temporary bypass flag to render pin creation
  renderPinUI();
}

async function handleGatekeeperSheetLink() {
  const urlInp = document.getElementById('gatekeeperScriptUrl');
  const tokenInp = document.getElementById('gatekeeperApiToken');
  const msgEl = document.getElementById('gatekeeperLinkMsg');

  const newUrl = urlInp ? urlInp.value.trim() : '';
  const newToken = tokenInp ? tokenInp.value.trim() : '';

  if (!newUrl) {
    if (msgEl) {
      msgEl.innerText = 'Please enter a valid Web App Deployment URL.';
      msgEl.classList.remove('opacity-0');
    }
    return;
  }

  cloudScriptUrl = newUrl;
  apiToken = newToken;

  localStorage.setItem(SCRIPT_URL_KEY, cloudScriptUrl);
  localStorage.setItem(API_TOKEN_STORAGE_KEY, apiToken);

  if (msgEl) {
    msgEl.innerText = 'Connecting to Google Sheet...';
    msgEl.classList.remove('opacity-0', 'text-rose-500');
    msgEl.classList.add('text-emerald-500');
  }

  try {
    await fetchFromGoogleSheet();
    // After pulling from sheet, if pinHash is now loaded successfully, re-render gatekeeper to standard PIN view
    checkGatekeeperState();
  } catch (err) {
    if (msgEl) {
      msgEl.innerText = 'Connection failed. Check URL and Token.';
      msgEl.classList.remove('text-emerald-500', 'opacity-0');
      msgEl.classList.add('text-rose-500');
    }
  }
}

function renderStandardPinLayout(container) {
  container.innerHTML = `
    <div class="flex flex-col items-center space-y-2">
      <div class="h-14 w-14 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-500/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shadow-sm">
        <i data-lucide="shield-lock" class="w-7 h-7"></i>
      </div>
      <h2 id="pinTitle" class="text-xl font-extrabold tracking-tight text-slate-900 dark:text-white">Security Gatekeeper</h2>
      <p id="pinSubtitle" class="text-xs text-slate-500 dark:text-slate-400">Enter your PIN to unlock</p>
    </div>

    <!-- PIN Input Digits Display -->
    <div class="flex justify-center items-center space-x-3.5 py-2">
      <div id="pinDot-0" class="w-4 h-4 rounded-full border-2 border-slate-300 dark:border-slate-700 transition-all duration-150"></div>
      <div id="pinDot-1" class="w-4 h-4 rounded-full border-2 border-slate-300 dark:border-slate-700 transition-all duration-150"></div>
      <div id="pinDot-2" class="w-4 h-4 rounded-full border-2 border-slate-300 dark:border-slate-700 transition-all duration-150"></div>
      <div id="pinDot-3" class="w-4 h-4 rounded-full border-2 border-slate-300 dark:border-slate-700 transition-all duration-150"></div>
    </div>

    <div id="pinStatusMsg" class="text-xs font-semibold h-4 text-rose-500 transition-opacity opacity-0">Incorrect PIN. Try again.</div>

    <!-- Numeric Keypad -->
    <div class="grid grid-cols-3 gap-3 max-w-[260px] mx-auto">
      <button onclick="pressPinDigit('1')" class="h-13 py-3 rounded-2xl bg-slate-100 hover:bg-slate-200 dark:bg-[#1A1F2E] dark:hover:bg-[#232A3B] text-slate-900 dark:text-white font-bold text-lg transition active:scale-95">1</button>
      <button onclick="pressPinDigit('2')" class="h-13 py-3 rounded-2xl bg-slate-100 hover:bg-slate-200 dark:bg-[#1A1F2E] dark:hover:bg-[#232A3B] text-slate-900 dark:text-white font-bold text-lg transition active:scale-95">2</button>
      <button onclick="pressPinDigit('3')" class="h-13 py-3 rounded-2xl bg-slate-100 hover:bg-slate-200 dark:bg-[#1A1F2E] dark:hover:bg-[#232A3B] text-slate-900 dark:text-white font-bold text-lg transition active:scale-95">3</button>
      <button onclick="pressPinDigit('4')" class="h-13 py-3 rounded-2xl bg-slate-100 hover:bg-slate-200 dark:bg-[#1A1F2E] dark:hover:bg-[#232A3B] text-slate-900 dark:text-white font-bold text-lg transition active:scale-95">4</button>
      <button onclick="pressPinDigit('5')" class="h-13 py-3 rounded-2xl bg-slate-100 hover:bg-slate-200 dark:bg-[#1A1F2E] dark:hover:bg-[#232A3B] text-slate-900 dark:text-white font-bold text-lg transition active:scale-95">5</button>
      <button onclick="pressPinDigit('6')" class="h-13 py-3 rounded-2xl bg-slate-100 hover:bg-slate-200 dark:bg-[#1A1F2E] dark:hover:bg-[#232A3B] text-slate-900 dark:text-white font-bold text-lg transition active:scale-95">6</button>
      <button onclick="pressPinDigit('7')" class="h-13 py-3 rounded-2xl bg-slate-100 hover:bg-slate-200 dark:bg-[#1A1F2E] dark:hover:bg-[#232A3B] text-slate-900 dark:text-white font-bold text-lg transition active:scale-95">7</button>
      <button onclick="pressPinDigit('8')" class="h-13 py-3 rounded-2xl bg-slate-100 hover:bg-slate-200 dark:bg-[#1A1F2E] dark:hover:bg-[#232A3B] text-slate-900 dark:text-white font-bold text-lg transition active:scale-95">8</button>
      <button onclick="pressPinDigit('9')" class="h-13 py-3 rounded-2xl bg-slate-100 hover:bg-slate-200 dark:bg-[#1A1F2E] dark:hover:bg-[#232A3B] text-slate-900 dark:text-white font-bold text-lg transition active:scale-95">9</button>
      <button onclick="clearPinInput()" class="h-13 py-3 rounded-2xl text-xs font-semibold text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white transition">Clear</button>
      <button onclick="pressPinDigit('0')" class="h-13 py-3 rounded-2xl bg-slate-100 hover:bg-slate-200 dark:bg-[#1A1F2E] dark:hover:bg-[#232A3B] text-slate-900 dark:text-white font-bold text-lg transition active:scale-95">0</button>
      <button onclick="backspacePinDigit()" class="h-13 py-3 rounded-2xl flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#1A1F2E] transition active:scale-95">
        <i data-lucide="delete" class="w-5 h-5"></i>
      </button>
    </div>

    <div class="text-[11.5px] text-slate-400 dark:text-slate-500 pt-2 border-t border-slate-100 dark:border-[#222836] flex items-center justify-center space-x-1.5">
      <span>Type on keyboard or keypad. Reset:</span>
      <details class="relative inline-block text-left">
        <summary class="list-none cursor-pointer inline-flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 focus:outline-none" title="Click for instructions">
          <i data-lucide="info" class="w-3.5 h-3.5"></i>
        </summary>
        <div class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 p-3 bg-slate-900 dark:bg-[#1A1F2E] text-white text-[10.5px] rounded-xl shadow-2xl border border-slate-700 z-50 text-left leading-relaxed">
          Clear the <code class="font-mono text-emerald-400 bg-black/50 px-1 py-0.5 rounded">pinHash</code> row in your Google Sheet <b>Settings</b> tab to reset your PIN.
        </div>
      </details>
    </div>
  `;

  if (window.lucide) lucide.createIcons();

  const title = document.getElementById('pinTitle');
  const subtitle = document.getElementById('pinSubtitle');

  // If pinHash is empty or set to TEMP_FLAG, handle setup mode
  if (!appSettings.pinHash || appSettings.pinHash === 'TEMP_FLAG') {
    if (appSettings.pinHash === 'TEMP_FLAG') appSettings.pinHash = ''; // clear temp flag for setup
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
