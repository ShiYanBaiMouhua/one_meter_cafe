const TZ = "Asia/Shanghai";
const LOG_COLLECTION = "guestNumberLogs";
const ADMIN_META_COLLECTION = "adminMeta";
const DUPLICATE_BANNER_DOC = "duplicateBanner";
const CURRENT_CALL_DOC = "currentCall";
const DUPLICATE_WARNING_DEFAULT = "有重复号码，请检查记录";
/** 与顾客端试听一致：001 号音频 ×2 + proceed（仅本机预览，不影响前台） */
const ADMIN_TEST_CALL_PADDED = "001";
const ADMIN_PROCEED_SOUND = "sound/proceed.mp3";
/** 与前台可输入范围上限一致（script.js MAX_GUEST_NUMBER） */
const GUEST_CAPACITY = 162;

const screenHome = document.getElementById("screen-admin-home");
const screenList = document.getElementById("screen-admin-list");
const btnBrowse = document.getElementById("btn-browse-logs");
const btnBack = document.getElementById("btn-admin-back");
const listStatus = document.getElementById("admin-list-status");
const logList = document.getElementById("admin-log-list");
const homeLoginStatus = document.getElementById("admin-home-login-status");
const homeCalledStatus = document.getElementById("admin-home-called");
const homeWaitingStatus = document.getElementById("admin-home-waiting");
const homeCallingStatus = document.getElementById("admin-home-calling");
const btnCallNext = document.getElementById("btn-call-next");
const btnReplayAnnouncement = document.getElementById(
  "btn-replay-announcement"
);
const btnClearAll = document.getElementById("btn-clear-all-logs");
const duplicateWarning = document.getElementById("admin-duplicate-warning");
const duplicateWarningText = document.getElementById(
  "admin-duplicate-warning-text"
);
const btnDismissDuplicate = document.getElementById(
  "btn-dismiss-duplicate-warning"
);
const btnAdminTestCallSound = document.getElementById(
  "btn-admin-test-call-sound"
);

/** 首页统计：日志快照 + currentCall 快照 */
let latestLogSnap = null;
let latestCurrentCall = null;
let unsubLogsStats = null;
let unsubCurrentCall = null;

function showHome() {
  screenList.hidden = true;
  screenList.setAttribute("aria-hidden", "true");
  screenHome.hidden = false;
  screenHome.removeAttribute("aria-hidden");
}

function applyHomeStatsFromCache() {
  if (!latestLogSnap || !homeLoginStatus) return;
  const cc = latestCurrentCall || {
    activeLogId: null,
    activeNumber: null,
    replayTick: 0,
  };
  const activeId = cc.activeLogId || null;
  let called = 0;
  let waiting = 0;
  latestLogSnap.forEach((doc) => {
    const d = doc.data();
    if (d.done === true) {
      called += 1;
      return;
    }
    if (activeId && doc.id === activeId) {
      return;
    }
    waiting += 1;
  });
  homeLoginStatus.textContent = `已登入${latestLogSnap.size}/${GUEST_CAPACITY}`;
  if (homeCalledStatus) {
    homeCalledStatus.textContent = `已叫号：${called}`;
  }
  if (homeWaitingStatus) {
    homeWaitingStatus.textContent = `等待中：${waiting}`;
  }
  if (homeCallingStatus) {
    const num =
      activeId &&
      typeof cc.activeNumber === "string" &&
      cc.activeNumber.length > 0
        ? cc.activeNumber
        : "—";
    homeCallingStatus.textContent = `叫号中：${num}`;
  }
  if (btnReplayAnnouncement) {
    const showReplay =
      Boolean(activeId) &&
      typeof cc.activeNumber === "string" &&
      cc.activeNumber.length > 0;
    btnReplayAnnouncement.hidden = !showReplay;
  }
}

/**
 * 实时：集合快照 + currentCall，更新已登入 / 已叫号 / 等待中 / 叫号中
 */
function subscribeHomeStats() {
  if (typeof firebase === "undefined") return;
  if (unsubLogsStats) {
    unsubLogsStats();
    unsubLogsStats = null;
  }
  if (unsubCurrentCall) {
    unsubCurrentCall();
    unsubCurrentCall = null;
  }
  latestLogSnap = null;
  latestCurrentCall = null;

  if (homeLoginStatus) homeLoginStatus.textContent = "加载中…";
  if (homeCalledStatus) homeCalledStatus.textContent = "已叫号：…";
  if (homeWaitingStatus) homeWaitingStatus.textContent = "等待中：…";
  if (homeCallingStatus) homeCallingStatus.textContent = "叫号中：…";
  if (btnReplayAnnouncement) btnReplayAnnouncement.hidden = true;

  const db = firebase.firestore();
  unsubLogsStats = db.collection(LOG_COLLECTION).onSnapshot(
    (snap) => {
      latestLogSnap = snap;
      applyHomeStatsFromCache();
    },
    (err) => {
      console.error("guestNumberLogs 监听失败", err);
      if (homeLoginStatus) homeLoginStatus.textContent = `已登入—/${GUEST_CAPACITY}`;
    }
  );

  unsubCurrentCall = db
    .collection(ADMIN_META_COLLECTION)
    .doc(CURRENT_CALL_DOC)
    .onSnapshot(
      (snap) => {
        latestCurrentCall = snap.exists
          ? snap.data()
          : { activeLogId: null, activeNumber: null, replayTick: 0 };
        applyHomeStatsFromCache();
      },
      (err) => console.error("currentCall 监听失败", err)
    );
}

function createdAtMillisFromDoc(doc) {
  const ts = doc.data().createdAt;
  if (ts && typeof ts.toMillis === "function") return ts.toMillis();
  return 0;
}

async function callNextNumber() {
  const db = firebase.firestore();
  const metaRef = db.collection(ADMIN_META_COLLECTION).doc(CURRENT_CALL_DOC);
  const metaSnap = await metaRef.get();
  const prevId = metaSnap.exists ? metaSnap.data().activeLogId : null;

  if (prevId) {
    const prevRef = db.collection(LOG_COLLECTION).doc(prevId);
    const prevDoc = await prevRef.get();
    if (prevDoc.exists && prevDoc.data().done !== true) {
      await prevRef.update({ done: true });
    }
  }

  const logsSnap = await db.collection(LOG_COLLECTION).get();
  const waitingDocs = logsSnap.docs.filter((doc) => doc.data().done !== true);

  if (waitingDocs.length === 0) {
    await metaRef.set(
      { activeLogId: null, activeNumber: null, replayTick: 0 },
      { merge: true }
    );
    window.alert("暂无等待中的记录");
    return;
  }

  waitingDocs.sort(
    (a, b) => createdAtMillisFromDoc(a) - createdAtMillisFromDoc(b)
  );
  const pick = waitingDocs[0];
  const num = pick.data().number;
  await metaRef.set(
    { activeLogId: pick.id, activeNumber: num, replayTick: 0 },
    { merge: true }
  );
}

async function replayCurrentCallAnnouncement() {
  const db = firebase.firestore();
  const metaRef = db.collection(ADMIN_META_COLLECTION).doc(CURRENT_CALL_DOC);
  const snap = await metaRef.get();
  if (!snap.exists) return;
  const d = snap.data();
  if (!d.activeLogId || typeof d.activeNumber !== "string" || !d.activeNumber.length) {
    return;
  }
  const cur =
    typeof d.replayTick === "number" && d.replayTick >= 0 ? d.replayTick : 0;
  await metaRef.set(
    {
      activeLogId: d.activeLogId,
      activeNumber: d.activeNumber,
      replayTick: cur + 1,
    },
    { merge: true }
  );
}

function playOneAudioAdmin(url) {
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

/** 与顾客端叫号序列一致，仅本机试听（不写入 Firestore） */
async function adminPlayTestCallSoundSequence() {
  const n = parseInt(ADMIN_TEST_CALL_PADDED, 10);
  const numberUrl = `sound/${n}.mp3`;
  await playOneAudioAdmin(numberUrl);
  await playOneAudioAdmin(numberUrl);
  await playOneAudioAdmin(ADMIN_PROCEED_SOUND);
}

function updateDuplicateBannerUI(data) {
  if (!duplicateWarning || !duplicateWarningText) return;
  const visible = data?.visible === true;
  duplicateWarning.hidden = !visible;
  duplicateWarning.setAttribute("aria-hidden", visible ? "false" : "true");
  duplicateWarningText.textContent = visible
    ? typeof data?.message === "string" && data.message.trim()
      ? data.message.trim()
      : DUPLICATE_WARNING_DEFAULT
    : "";
}

function subscribeDuplicateBanner() {
  if (typeof firebase === "undefined") return;
  const db = firebase.firestore();
  db.collection(ADMIN_META_COLLECTION)
    .doc(DUPLICATE_BANNER_DOC)
    .onSnapshot(
      (snap) => {
        updateDuplicateBannerUI(
          snap.exists ? snap.data() : { visible: false }
        );
      },
      (err) => console.error("duplicateBanner listen failed", err)
    );
}

if (btnDismissDuplicate) {
  btnDismissDuplicate.addEventListener("click", () => {
    if (typeof firebase === "undefined") return;
    const db = firebase.firestore();
    db.collection(ADMIN_META_COLLECTION)
      .doc(DUPLICATE_BANNER_DOC)
      .set({ visible: false }, { merge: true })
      .catch((err) => console.error(err));
  });
}

function setClearAllEnabled(itemCount, loading) {
  if (!btnClearAll) return;
  btnClearAll.disabled = Boolean(loading) || itemCount === 0;
}

/** 按文档 ID 分页删除整表（每批最多 500 条 write） */
async function deleteAllGuestLogs() {
  const db = firebase.firestore();
  const coll = db.collection(LOG_COLLECTION);
  const docIdPath = firebase.firestore.FieldPath.documentId();
  const pageSize = 500;
  let lastDoc = null;

  for (;;) {
    let q = coll.orderBy(docIdPath).limit(pageSize);
    if (lastDoc) {
      q = q.startAfter(lastDoc);
    }
    const snap = await q.get();
    if (snap.empty) {
      break;
    }
    const batch = db.batch();
    for (const d of snap.docs) {
      batch.delete(d.ref);
    }
    await batch.commit();
    lastDoc = snap.docs[snap.docs.length - 1];
    if (snap.size < pageSize) {
      break;
    }
  }
}

function showList() {
  screenHome.hidden = true;
  screenHome.setAttribute("aria-hidden", "true");
  screenList.hidden = false;
  screenList.removeAttribute("aria-hidden");
}

function formatTime(ms) {
  if (ms == null || Number.isNaN(ms)) return "—";
  try {
    return new Intl.DateTimeFormat("zh-Hans-CN", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date(ms));
  } catch {
    return "—";
  }
}

function renderItems(items, onDelete, onRequeue) {
  logList.innerHTML = "";
  if (!items.length) {
    const empty = document.createElement("li");
    empty.className = "admin-log-empty";
    empty.textContent = "暂无记录";
    logList.appendChild(empty);
    return;
  }
  for (const row of items) {
    const li = document.createElement("li");
    li.className = "admin-log-row";

    const top = document.createElement("div");
    top.className = "admin-log-row-top";

    const num = document.createElement("p");
    num.className = "admin-log-number";
    num.textContent = row.number ?? "—";

    const time = document.createElement("p");
    time.className = "admin-log-time";
    time.textContent = formatTime(row.createdAtMs);

    top.appendChild(num);
    top.appendChild(time);

    const actions = document.createElement("div");
    actions.className = "admin-log-row-actions";

    const badge = document.createElement("span");
    badge.className = row.done
      ? "admin-log-badge admin-log-badge-done"
      : "admin-log-badge admin-log-badge-wait";
    badge.textContent = row.done ? "已叫号" : "等待中";

    const btnRequeue = document.createElement("button");
    btnRequeue.type = "button";
    btnRequeue.className = "admin-log-requeue";
    btnRequeue.textContent = "回到队列";
    btnRequeue.disabled = !row.done;
    btnRequeue.setAttribute(
      "aria-label",
      row.done
        ? `将号码 ${row.number ?? ""} 放回等待队列`
        : "仅已叫号记录可回到队列"
    );
    if (row.done) {
      btnRequeue.addEventListener("click", () => onRequeue(row.id, btnRequeue));
    }

    const btnDel = document.createElement("button");
    btnDel.type = "button";
    btnDel.className = "admin-log-delete";
    btnDel.textContent = "删除";
    btnDel.setAttribute("aria-label", `删除号码 ${row.number ?? ""}`);
    btnDel.addEventListener("click", () => onDelete(row.id, btnDel));

    actions.appendChild(badge);
    actions.appendChild(btnRequeue);
    actions.appendChild(btnDel);

    li.appendChild(top);
    li.appendChild(actions);
    logList.appendChild(li);
  }
}

function firestoreErrorHint(err) {
  const code = err?.code || "";
  if (code === "permission-denied") {
    return "无权限：请在 Firebase 控制台部署最新的 Firestore 规则（guestNumberLogs 允许 read / delete）。";
  }
  if (code === "failed-precondition") {
    return "查询需要索引：请打开浏览器控制台里的 Firebase 链接一键创建索引后重试。";
  }
  if (code === "unavailable") {
    return "网络不可用，请检查连接后重试。";
  }
  const msg = typeof err?.message === "string" ? err.message : "";
  return msg ? `加载失败：${msg}` : "加载失败，请重试";
}

async function fetchLogItems() {
  const db = firebase.firestore();
  const snap = await db
    .collection(LOG_COLLECTION)
    .orderBy("createdAt", "desc")
    .limit(500)
    .get();

  return snap.docs.map((d) => {
    const data = d.data();
    const ts = data.createdAt;
    const createdAtMs =
      ts && typeof ts.toMillis === "function" ? ts.toMillis() : null;
    return {
      id: d.id,
      number: data.number,
      createdAtMs,
      done: data.done === true,
    };
  });
}

async function deleteLogDoc(docId, buttonEl) {
  const prev = buttonEl.textContent;
  buttonEl.disabled = true;
  buttonEl.textContent = "…";
  try {
    const db = firebase.firestore();
    await db.collection(LOG_COLLECTION).doc(docId).delete();
    const metaRef = db
      .collection(ADMIN_META_COLLECTION)
      .doc(CURRENT_CALL_DOC);
    const mSnap = await metaRef.get();
    if (mSnap.exists && mSnap.data().activeLogId === docId) {
      await metaRef.set(
        { activeLogId: null, activeNumber: null, replayTick: 0 },
        { merge: true }
      );
    }
    const items = await fetchLogItems();
    listStatus.textContent = `共 ${items.length} 条（最多显示 500 条）`;
    setClearAllEnabled(items.length, false);
    renderItems(items, deleteLogDoc, requeueLogDoc);
  } catch (err) {
    console.error(err);
    listStatus.textContent = firestoreErrorHint(err);
    buttonEl.disabled = false;
    buttonEl.textContent = prev;
  }
}

async function requeueLogDoc(docId, buttonEl) {
  const prev = buttonEl.textContent;
  buttonEl.disabled = true;
  buttonEl.textContent = "…";
  try {
    const db = firebase.firestore();
    await db.collection(LOG_COLLECTION).doc(docId).update({ done: false });
    const items = await fetchLogItems();
    listStatus.textContent = `共 ${items.length} 条（最多显示 500 条）`;
    setClearAllEnabled(items.length, false);
    renderItems(items, deleteLogDoc, requeueLogDoc);
  } catch (err) {
    console.error(err);
    listStatus.textContent = firestoreErrorHint(err);
    buttonEl.disabled = false;
    buttonEl.textContent = prev;
  }
}

async function loadLogs() {
  listStatus.textContent = "加载中…";
  setClearAllEnabled(0, true);
  renderItems([], deleteLogDoc, requeueLogDoc);
  try {
    const items = await fetchLogItems();
    listStatus.textContent = `共 ${items.length} 条（最多显示 500 条）`;
    setClearAllEnabled(items.length, false);
    renderItems(items, deleteLogDoc, requeueLogDoc);
  } catch (err) {
    console.error(err);
    listStatus.textContent = firestoreErrorHint(err);
    setClearAllEnabled(0, false);
    renderItems([], deleteLogDoc, requeueLogDoc);
  }
}

if (btnClearAll) {
  btnClearAll.addEventListener("click", async () => {
    if (btnClearAll.disabled) return;
    const ok = window.confirm("确定删除全部记录？此操作不可恢复。");
    if (!ok) return;

    const prevLabel = btnClearAll.textContent;
    btnClearAll.disabled = true;
    if (btnBack) btnBack.disabled = true;
    listStatus.textContent = "正在清除全部记录…";
    try {
      await deleteAllGuestLogs();
      await firebase
        .firestore()
        .collection(ADMIN_META_COLLECTION)
        .doc(DUPLICATE_BANNER_DOC)
        .set({ visible: false }, { merge: true });
      await firebase
        .firestore()
        .collection(ADMIN_META_COLLECTION)
        .doc(CURRENT_CALL_DOC)
        .set(
          { activeLogId: null, activeNumber: null, replayTick: 0 },
          { merge: true }
        );
      listStatus.textContent = "共 0 条（最多显示 500 条）";
      setClearAllEnabled(0, false);
      renderItems([], deleteLogDoc, requeueLogDoc);
    } catch (err) {
      console.error(err);
      listStatus.textContent = firestoreErrorHint(err);
      await loadLogs();
    } finally {
      btnClearAll.textContent = prevLabel;
      if (btnBack) btnBack.disabled = false;
    }
  });
}

if (btnCallNext) {
  btnCallNext.addEventListener("click", async () => {
    if (btnCallNext.disabled) return;
    btnCallNext.disabled = true;
    try {
      await callNextNumber();
    } catch (e) {
      console.error(e);
      window.alert(
        "叫号失败：请检查网络，并确认已部署包含 done 字段与 currentCall 的 Firestore 规则。"
      );
    } finally {
      btnCallNext.disabled = false;
    }
  });
}

if (btnReplayAnnouncement) {
  btnReplayAnnouncement.addEventListener("click", async () => {
    if (btnReplayAnnouncement.disabled || btnReplayAnnouncement.hidden) return;
    btnReplayAnnouncement.disabled = true;
    try {
      await replayCurrentCallAnnouncement();
    } catch (e) {
      console.error(e);
      window.alert("再次呼叫失败，请检查网络与 Firestore 规则是否已部署。");
    } finally {
      btnReplayAnnouncement.disabled = false;
    }
  });
}

if (btnAdminTestCallSound) {
  btnAdminTestCallSound.addEventListener("click", async () => {
    if (btnAdminTestCallSound.disabled) return;
    btnAdminTestCallSound.disabled = true;
    try {
      await adminPlayTestCallSoundSequence();
    } catch (e) {
      console.error(e);
      window.alert(
        "播放失败：请确认 sound 资源可访问，或在浏览器中允许本站播放声音后重试。"
      );
    } finally {
      btnAdminTestCallSound.disabled = false;
    }
  });
}

btnBrowse.addEventListener("click", async () => {
  showList();
  await loadLogs();
});

btnBack.addEventListener("click", () => {
  showHome();
});

subscribeHomeStats();
subscribeDuplicateBanner();
