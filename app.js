// 替換為你的 Worker 網址
const API_BASE = "https://stock-api.natsuki3m.workers.dev";

let currentYear = 2026;
let currentMonth = 10; // 1-12
let selectedDate = "2026-10-23";
let calendarData = { events: [], activeNewsDates: [] };

const calendarEl = document.getElementById("calendar");
const monthLabelEl = document.getElementById("current-month-label");
const newsContainerEl = document.getElementById("news-container");
const selectedDateLabelEl = document.getElementById("selected-date-label");

async function fetchCalendarData(year, month) {
  const monthStr = `${year}-${String(month).padStart(2, "0")}`;
  try {
    const res = await fetch(`${API_BASE}/api/calendar?month=${monthStr}`);
    calendarData = await res.json();
    renderCalendar();
  } catch (err) {
    console.error("載入行事曆失敗:", err);
  }
}

async function fetchNewsData(date) {
  selectedDateLabelEl.innerText = `${date} 重大美股快訊`;
  newsContainerEl.innerHTML = `<p style="color:#94a3b8;">載入中...</p>`;
  try {
    const res = await fetch(`${API_BASE}/api/news?date=${date}`);
    const newsList = await res.json();
    if (!newsList || newsList.length === 0) {
      newsContainerEl.innerHTML = `<p style="color:#94a3b8; font-size:0.9rem;">此日期無新聞存檔。</p>`;
      return;
    }
    newsContainerEl.innerHTML = newsList.map(n => `
      <div class="news-item">
        <div class="news-title">
          ${n.source_or_ticker ? `<span class="news-ticker">${n.source_or_ticker}</span>` : ""}
          ${n.title}
        </div>
        <div class="news-summary">${n.summary}</div>
      </div>
    `).join("");
  } catch (err) {
    newsContainerEl.innerHTML = `<p style="color:#ef4444;">載入失敗: ${err.message}</p>`;
  }
}

function renderCalendar() {
  monthLabelEl.innerText = `${currentYear} 年 ${currentMonth} 月`;
  calendarEl.innerHTML = "";

  const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
  weekdays.forEach(day => {
    const header = document.createElement("div");
    header.className = "day-header";
    header.innerText = day;
    calendarEl.appendChild(header);
  });

  const firstDay = new Date(currentYear, currentMonth - 1, 1).getDay();
  const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();

  for (let i = 0; i < firstDay; i++) {
    const emptyCell = document.createElement("div");
    emptyCell.className = "day-cell other-month";
    calendarEl.appendChild(emptyCell);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${currentYear}-${String(currentMonth).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const cell = document.createElement("div");
    cell.className = `day-cell ${dateStr === selectedDate ? "selected" : ""}`;

    const numSpan = document.createElement("span");
    numSpan.innerText = d;
    cell.appendChild(numSpan);

    // 綠點：當天有新聞
    if (calendarData.activeNewsDates?.includes(dateStr)) {
      const dot = document.createElement("div");
      dot.className = "news-dot";
      cell.appendChild(dot);
    }

    // 標籤：財報/FOMC 行事曆
    const dayEvents = (calendarData.events || []).filter(e => e.event_date === dateStr);
    dayEvents.slice(0, 2).forEach(ev => {
      const badge = document.createElement("div");
      badge.className = `event-badge badge-${ev.category}`;
      badge.innerText = ev.ticker ? `${ev.ticker} 財報` : ev.title;
      badge.title = ev.title;
      cell.appendChild(badge);
    });

    cell.addEventListener("click", () => {
      document.querySelectorAll(".day-cell").forEach(c => c.classList.remove("selected"));
      cell.classList.add("selected");
      selectedDate = dateStr;
      fetchNewsData(dateStr);
    });

    calendarEl.appendChild(cell);
  }
}

document.getElementById("prev-month").onclick = () => {
  if (currentMonth === 1) { currentMonth = 12; currentYear--; }
  else { currentMonth--; }
  fetchCalendarData(currentYear, currentMonth);
};

document.getElementById("next-month").onclick = () => {
  if (currentMonth === 12) { currentMonth = 1; currentYear++; }
  else { currentMonth++; }
  fetchCalendarData(currentYear, currentMonth);
};

// 註冊 Service Worker 達成 PWA
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(console.error);
}

// 初始化載入
fetchCalendarData(currentYear, currentMonth);
fetchNewsData(selectedDate);