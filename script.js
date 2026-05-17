const TICKET_LEN = 3;
const WAIT_RETURN_MS = 5000;

function recordGuestNumberSilent(numberStr) {
  if (typeof firebase === "undefined") return;
  try {
    const db = firebase.firestore();
    db.collection("guestNumberLogs")
      .add({
        number: numberStr,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      })
      .catch((err) => {
        console.warn("guestNumberLogs write failed", err);
      });
  } catch (err) {
    console.warn("guestNumberLogs write failed", err);
  }
}

const screenTicket = document.getElementById("screen-ticket");
const screenWait = document.getElementById("screen-wait");
const ticketNumberEl = document.getElementById("ticket-number");
const btnConfirm = document.getElementById("btn-confirm");
const btnWaitBack = document.getElementById("btn-wait-back");
const waitBackCountEl = document.getElementById("wait-back-count");

/** @type {string[]} */
const digits = [];

let returnToTicketTimerId = null;
let waitCountdownIntervalId = null;
let waitEndsAt = 0;

function render() {
  const parts = [];
  for (let i = 0; i < TICKET_LEN; i++) {
    parts.push(i < digits.length ? digits[i] : "_");
  }
  ticketNumberEl.textContent = parts.join(" ");
  btnConfirm.disabled = digits.length !== TICKET_LEN;
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
  ticketNumberEl.focus();
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

render();
ticketNumberEl.focus();
