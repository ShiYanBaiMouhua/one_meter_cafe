const TZ = "Asia/Shanghai";
const LOG_COLLECTION = "guestNumberLogs";
const ADMIN_META_COLLECTION = "adminMeta";
const DUPLICATE_BANNER_DOC = "duplicateBanner";
const DUPLICATE_WARNING_DEFAULT = "有重复号码，请检查记录";
/** 与前台可输入范围上限一致（script.js MAX_GUEST_NUMBER） */
const GUEST_CAPACITY = 162;

const screenHome = document.getElementById("screen-admin-home");
const screenList = document.getElementById("screen-admin-list");
const btnBrowse = document.getElementById("btn-browse-logs");
const btnBack = document.getElementById("btn-admin-back");
const listStatus = document.getElementById("admin-list-status");
const logList = document.getElementById("admin-log-list");
const homeLoginStatus = document.getElementById("admin-home-login-status");
const btnClearAll = document.getElementById("btn-clear-all-logs");
const duplicateWarning = document.getElementById("admin-duplicate-warning");
const duplicateWarningText = document.getElementById(
  "admin-duplicate-warning-text"
);
const btnDismissDuplicate = document.getElementById(
  "btn-dismiss-duplicate-warning"
);

/** 第一页「已登入」实时监听取消函数 */
let unsubscribeHomeLogCount = null;

function showHome() {
  screenList.hidden = true;
  screenList.setAttribute("aria-hidden", "true");
  screenHome.hidden = false;
  screenHome.removeAttribute("aria-hidden");
}

/**
 * 监听 guestNumberLogs，实时更新首页「已登入 X/162」
 * （整表快照；记录量很大时若卡顿可再改成仅 count 轮询）
 */
function subscribeHomeLoginCount() {
  if (!homeLoginStatus || typeof firebase === "undefined") return;
  if (unsubscribeHomeLogCount) {
    unsubscribeHomeLogCount();
    unsubscribeHomeLogCount = null;
  }
  homeLoginStatus.textContent = "加载中…";
  const db = firebase.firestore();
  unsubscribeHomeLogCount = db.collection(LOG_COLLECTION).onSnapshot(
    (snap) => {
      homeLoginStatus.textContent = `已登入${snap.size}/${GUEST_CAPACITY}`;
    },
    (err) => {
      console.error("guestNumberLogs 实时计数失败", err);
      homeLoginStatus.textContent = `已登入—/${GUEST_CAPACITY}`;
    }
  );
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

function renderItems(items, onDelete) {
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

    const btnDel = document.createElement("button");
    btnDel.type = "button";
    btnDel.className = "admin-log-delete";
    btnDel.textContent = "删除";
    btnDel.setAttribute("aria-label", `删除号码 ${row.number ?? ""}`);
    btnDel.addEventListener("click", () => onDelete(row.id, btnDel));

    li.appendChild(top);
    li.appendChild(btnDel);
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
    const items = await fetchLogItems();
    listStatus.textContent = `共 ${items.length} 条（最多显示 500 条）`;
    setClearAllEnabled(items.length, false);
    renderItems(items, deleteLogDoc);
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
  renderItems([], deleteLogDoc);
  try {
    const items = await fetchLogItems();
    listStatus.textContent = `共 ${items.length} 条（最多显示 500 条）`;
    setClearAllEnabled(items.length, false);
    renderItems(items, deleteLogDoc);
  } catch (err) {
    console.error(err);
    listStatus.textContent = firestoreErrorHint(err);
    setClearAllEnabled(0, false);
    renderItems([], deleteLogDoc);
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
      listStatus.textContent = "共 0 条（最多显示 500 条）";
      setClearAllEnabled(0, false);
      renderItems([], deleteLogDoc);
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

btnBrowse.addEventListener("click", async () => {
  showList();
  await loadLogs();
});

btnBack.addEventListener("click", () => {
  showHome();
});

subscribeHomeLoginCount();
subscribeDuplicateBanner();
