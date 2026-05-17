const TZ = "Asia/Shanghai";

const screenHome = document.getElementById("screen-admin-home");
const screenList = document.getElementById("screen-admin-list");
const btnBrowse = document.getElementById("btn-browse-logs");
const btnBack = document.getElementById("btn-admin-back");
const listStatus = document.getElementById("admin-list-status");
const logList = document.getElementById("admin-log-list");

function functionsRegion() {
  return window.FIREBASE_FUNCTIONS_REGION || "asia-east1";
}

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

function renderItems(items) {
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

    const num = document.createElement("p");
    num.className = "admin-log-number";
    num.textContent = row.number ?? "—";

    const time = document.createElement("p");
    time.className = "admin-log-time";
    time.textContent = formatTime(row.createdAtMs);

    li.appendChild(num);
    li.appendChild(time);
    logList.appendChild(li);
  }
}

async function loadLogs() {
  listStatus.textContent = "加载中…";
  renderItems([]);
  try {
    const fn = firebase
      .app()
      .functions(functionsRegion())
      .httpsCallable("listGuestNumbers");
    const res = await fn();
    const items = Array.isArray(res.data?.items) ? res.data.items : [];
    listStatus.textContent = `共 ${items.length} 条（最多显示 500 条）`;
    renderItems(items);
  } catch (err) {
    console.error(err);
    listStatus.textContent = "加载失败，请重试";
    renderItems([]);
  }
}

btnBrowse.addEventListener("click", async () => {
  showList();
  await loadLogs();
});

btnBack.addEventListener("click", () => {
  showHome();
});
