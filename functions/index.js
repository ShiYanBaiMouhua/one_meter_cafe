const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

initializeApp();

const db = getFirestore();

const SHOP_TIMEZONE = "Asia/Shanghai";
const MIN_TICKET = 1;
const MAX_TICKET = 300;
const COLLECTION = "ticketDays";

function todayKeyInTimezone(timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  if (!y || !m || !d) {
    throw new HttpsError("internal", "DATE_KEY_FAILED");
  }
  return `${y}-${m}-${d}`;
}

function normalizeUsed(raw) {
  if (!Array.isArray(raw)) return [];
  const nums = raw
    .map((n) => (typeof n === "number" ? n : parseInt(String(n), 10)))
    .filter((n) => Number.isInteger(n) && n >= MIN_TICKET && n <= MAX_TICKET);
  return [...new Set(nums)];
}

exports.assignDailyNumber = onCall(
  {
    region: "asia-east1",
    timeoutSeconds: 30,
    memory: "256MiB",
    // Gen2 runs on Cloud Run; allow unauthenticated Callable from the web app.
    invoker: "public",
    cors: true,
  },
  async () => {
    const dateKey = todayKeyInTimezone(SHOP_TIMEZONE);
    const docRef = db.collection(COLLECTION).doc(dateKey);

    try {
      const padded = await db.runTransaction(async (tx) => {
        const snap = await tx.get(docRef);
        const used = normalizeUsed(snap.exists ? snap.data()?.used : []);
        if (used.length >= MAX_TICKET) {
          throw new HttpsError("resource-exhausted", "SOLD_OUT");
        }
        const usedSet = new Set(used);
        const pool = [];
        for (let i = MIN_TICKET; i <= MAX_TICKET; i += 1) {
          if (!usedSet.has(i)) pool.push(i);
        }
        if (pool.length === 0) {
          throw new HttpsError("resource-exhausted", "SOLD_OUT");
        }
        const pick = pool[Math.floor(Math.random() * pool.length)];
        if (!snap.exists) {
          tx.set(docRef, { used: [pick], dateKey, timeZone: SHOP_TIMEZONE });
        } else {
          tx.update(docRef, { used: FieldValue.arrayUnion(pick) });
        }
        return String(pick).padStart(3, "0");
      });
      return { padded, number: parseInt(padded, 10) };
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      console.error("assignDailyNumber failed", err);
      throw new HttpsError("internal", "ASSIGN_FAILED");
    }
  }
);
