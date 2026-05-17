const TICKET_LEN = 3;
const WAIT_RETURN_MS = 5000;
/** 顾客输入号码须在 001–162（含）之间，Confirm 才可点 */
const MIN_GUEST_NUMBER = 1;
const MAX_GUEST_NUMBER = 162;

const LOG_COLLECTION = "guestNumberLogs";
const ADMIN_META = "adminMeta";
const DUPLICATE_BANNER_ID = "duplicateBanner";
const CURRENT_CALL_DOC = "currentCall";
const DUPLICATE_WARNING_TEXT = "有重复号码，请检查记录";

const PROCEED_SOUND_URL = "sound/proceed.mp3";

let lastAnnouncedLogId = null;

function playOneAudio(url) {
  return new Promise((resolve, reject) => {
    const audio = new Audio(url);
    audio.preload = "auto";
    const done = () => resolve();
    audio.addEventListener("ended", done, { once: true });
    audio.addEventListener(
      "error",
      () => reject(new Error(`音频加载失败: ${url}`)),
      { once: true }
    );
    audio.play().catch(reject);
  });
}

/** 号码音频两遍 + proceed.mp3 一遍 */
async function playCallAnnouncementSequence(paddedNumberStr) {
  const n = parseInt(String(paddedNumberStr), 10);
  if (
    !Number.isInteger(n) ||
    n < MIN_GUEST_NUMBER ||
    n > MAX_GUEST_NUMBER
  ) {
    return;
  }
  const numberUrl = `sound/${n}.mp3`;
  try {
    await playOneAudio(numberUrl);
    await playOneAudio(numberUrl);
    await playOneAudio(PROCEED_SOUND_URL);
  } catch (err) {
    console.warn(
      "叫号音频序列无法完整播放（请先轻触页面一次以解除浏览器限制）",
      err
    );
  }
}

function subscribeCurrentCallAnnouncements() {
  if (typeof firebase === "undefined") return;
  const db = firebase.firestore();
  db.collection(ADMIN_META)
    .doc(CURRENT_CALL_DOC)
    .onSnapshot(
      (snap) => {
        if (!snap.exists) {
          lastAnnouncedLogId = null;
          return;
        }
        const data = snap.data();
        const logId = data.activeLogId;
        const num = data.activeNumber;
        if (!logId || typeof num !== "string" || num.length === 0) {
          lastAnnouncedLogId = null;
          return;
        }
        if (logId === lastAnnouncedLogId) return;
        lastAnnouncedLogId = logId;
        playCallAnnouncementSequence(num);
      },
      (err) => console.error("currentCall 叫号监听失败", err)
    );
}

function recordGuestNumberSilent(numberStr) {
  if (typeof firebase === "undefined") return;
  const db = firebase.firestore();
  const logs = db.collection(LOG_COLLECTION);

  logs
    .add({
      number: numberStr,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      done: false,
    })
    .then(() =>
      logs.where("number", "==", numberStr).limit(2).get()
    )
    .then((sameSnap) => {
      if (sameSnap.size < 2) return;
      return db
        .collection(ADMIN_META)
        .doc(DUPLICATE_BANNER_ID)
        .set(
          {
            visible: true,
            message: DUPLICATE_WARNING_TEXT,
          },
          { merge: true }
        )
        .catch((err) => {
          console.error(
            "duplicateBanner 未写入：请在 Firebase 部署包含 adminMeta 的规则，并查看控制台。",
            err
          );
        });
    })
    .catch((err) => {
      console.warn("guestNumberLogs 写入或重复检测失败", err);
    });
}

const screenTicket = document.getElementById("screen-ticket");
const screenWait = document.getElementById("screen-wait");
const ticketNumberEl = document.getElementById("ticket-number");
const ticketNumberInput = document.getElementById("ticket-number-input");
const btnConfirm = document.getElementById("btn-confirm");
const btnWaitBack = document.getElementById("btn-wait-back");
const waitBackCountEl = document.getElementById("wait-back-count");

/** @type {string[]} */
const digits = [];

let returnToTicketTimerId = null;
let waitCountdownIntervalId = null;
let waitEndsAt = 0;

function isGuestNumberInRange() {
  if (digits.length !== TICKET_LEN) return false;
  const n = parseInt(digits.join(""), 10);
  return (
    Number.isInteger(n) &&
    n >= MIN_GUEST_NUMBER &&
    n <= MAX_GUEST_NUMBER
  );
}

function render() {
  const parts = [];
  for (let i = 0; i < TICKET_LEN; i++) {
    parts.push(i < digits.length ? digits[i] : "_");
  }
  ticketNumberEl.textContent = parts.join(" ");
  if (ticketNumberInput) {
    ticketNumberInput.value = digits.join("");
  }
  btnConfirm.disabled = !isGuestNumberInRange();
}

function clearWaitTimers() {
  if (returnToTicketTimerId !== null) {
    clearTimeout(returnToTicketTimerId);
    returnToTicketTimerId = null;
  }
  if (waitCountdownIntervalId !== null) {
    clearInterval(waitCountdownIntervalId);
    waitCountdownIntervalId = null;
  }
}

function tickWaitRemainingLabel() {
  if (!waitBackCountEl) return;
  const secs = Math.max(0, Math.ceil((waitEndsAt - Date.now()) / 1000));
  waitBackCountEl.textContent = String(secs);
}

function returnToTicketScreen() {
  clearWaitTimers();

  digits.length = 0;
  render();

  screenWait.hidden = true;
  screenWait.setAttribute("aria-hidden", "true");
  screenTicket.hidden = false;
  screenTicket.removeAttribute("aria-hidden");
  if (ticketNumberInput) {
    ticketNumberInput.focus();
  }
}

function startWaitCountdownAndAutoReturn() {
  clearWaitTimers();
  waitEndsAt = Date.now() + WAIT_RETURN_MS;
  tickWaitRemainingLabel();
  waitCountdownIntervalId = window.setInterval(tickWaitRemainingLabel, 200);
  returnToTicketTimerId = window.setTimeout(returnToTicketScreen, WAIT_RETURN_MS);
}

function addDigit(char) {
  if (digits.length >= TICKET_LEN) return;
  digits.push(char);
  render();
}

function removeLastDigit() {
  if (!digits.length) return;
  digits.pop();
  render();
}

window.addEventListener("keydown", (e) => {
  if (screenTicket.hidden) return;
  if (ticketNumberInput && e.target === ticketNumberInput) {
    return;
  }

  if (/^[0-9]$/.test(e.key)) {
    e.preventDefault();
    if (digits.length < TICKET_LEN) {
      addDigit(e.key);
    }
    return;
  }

  if (e.key === "Backspace") {
    if (digits.length === 0) return;
    e.preventDefault();
    removeLastDigit();
  }
});

btnConfirm.addEventListener("click", () => {
  if (btnConfirm.disabled || !screenTicket || !screenWait) {
    return;
  }
  if (!isGuestNumberInRange()) return;

  recordGuestNumberSilent(digits.join(""));

  screenTicket.hidden = true;
  screenTicket.setAttribute("aria-hidden", "true");
  screenWait.hidden = false;
  screenWait.removeAttribute("aria-hidden");

  startWaitCountdownAndAutoReturn();
});

btnWaitBack.addEventListener("click", () => {
  if (!screenWait || screenWait.hidden) return;
  returnToTicketScreen();
});

if (ticketNumberInput) {
  ticketNumberInput.addEventListener("input", () => {
    if (screenTicket.hidden) return;
    const raw = ticketNumberInput.value.replace(/\D/g, "").slice(0, TICKET_LEN);
    digits.length = 0;
    for (const ch of raw) {
      digits.push(ch);
    }
    render();
  });

  ticketNumberInput.addEventListener("keydown", (e) => {
    if (screenTicket.hidden) return;
    if (e.key === "Enter") {
      e.preventDefault();
      if (!btnConfirm.disabled) {
        btnConfirm.click();
      }
    }
  });
}

render();
subscribeCurrentCallAnnouncements();
