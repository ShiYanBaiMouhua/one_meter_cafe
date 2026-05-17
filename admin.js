const TZ = "Asia/Shanghai";
const LOG_COLLECTION = "guestNumberLogs";

const screenHome = document.getElementById("screen-admin-home");
const screenList = document.getElementById("screen-admin-list");
const btnBrowse = document.getElementById("btn-browse-logs");
const btnBack = document.getElementById("btn-admin-back");
const listStatus = document.getElementById("admin-list-status");
const logList = document.getElementById("admin-log-list");

function showHome() {
  screenList.hidden = true;
  screenList.setAttribute("aria-hidden", "true");
  screenHome.hidden = false;
  screenHome.removeAttribute("aria-hidden");
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
  renderItems([], deleteLogDoc);
  try {
    const items = await fetchLogItems();
    listStatus.textContent = `共 ${items.length} 条（最多显示 500 条）`;
    renderItems(items, deleteLogDoc);
  } catch (err) {
    console.error(err);
    listStatus.textContent = firestoreErrorHint(err);
    renderItems([], deleteLogDoc);
  }
}

btnBrowse.addEventListener("click", async () => {
  showList();
  await loadLogs();
});

btnBack.addEventListener("click", () => {
  showHome();
});
