// 直接使用你的 Worker 專屬網址
const WORKER_API_BASE = "https://stock-calendar-pwa.natsuki3m.workers.dev";

document.addEventListener('DOMContentLoaded', function() {
  // 註冊 PWA Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  const calendarEl = document.getElementById('calendar');
  const calendar = new FullCalendar.Calendar(calendarEl, {
    initialView: 'dayGridMonth',
    locale: 'zh-tw',
    // 取得月曆事件
    events: async function(fetchInfo, successCallback, failureCallback) {
      try {
        // 抓取月曆當前視圖中間日期的年月 (格式: YYYY-MM)
        const currentYearMonth = calendar.getDate().toISOString().slice(0, 7);
        const res = await fetch(`${WORKER_API_BASE}/api/month-events?month=${currentYearMonth}`);
        const data = await res.json();

        const events = (data || []).map(item => ({
          title: `[${item.category}] ${item.title}`,
          start: item.event_date,
          backgroundColor: item.category.includes('財報') ? '#2563eb' : '#dc2626',
          borderColor: item.category.includes('財報') ? '#1d4ed8' : '#b91c1c'
        }));
        successCallback(events);
      } catch (e) {
        console.error("載入事件失敗:", e);
        failureCallback(e);
      }
    },
    // 點擊日期格子時載入當日 5 則新聞
    dateClick: function(info) {
      loadDailyNews(info.dateStr);
    }
  });

  calendar.render();

  // 預設直接載入今天的焦點新聞
  const todayStr = new Date().toISOString().split('T')[0];
  loadDailyNews(todayStr);
});

async function loadDailyNews(dateStr) {
  const container = document.getElementById('news-section');
  const title = document.getElementById('selected-date-title');
  const list = document.getElementById('news-list');

  if (!container || !title || !list) return;

  title.innerText = `${dateStr} 美股焦點新聞`;
  list.innerHTML = '<p class="text-gray-500">載入中...</p>';
  container.classList.remove('hidden');

  try {
    const res = await fetch(`${WORKER_API_BASE}/api/daily-news?date=${dateStr}`);
    const news = await res.json();

    if (!news || news.length === 0) {
      list.innerHTML = '<p class="text-gray-400">當日尚無新聞記錄或非交易日。</p>';
      return;
    }

    list.innerHTML = news.map((n, idx) => `
      <div class="border-b border-gray-100 pb-3 last:border-b-0">
        <h3 class="font-semibold text-lg text-slate-900">${idx + 1}. ${n.title}</h3>
        <p class="text-slate-600 text-sm mt-1 leading-relaxed">${n.summary}</p>
        ${n.impact_tickers ? `<span class="inline-block mt-2 px-2.5 py-0.5 bg-blue-50 text-blue-700 text-xs rounded-full font-medium border border-blue-200">相關標的: ${n.impact_tickers}</span>` : ''}
      </div>
    `).join('');
  } catch (err) {
    list.innerHTML = '<p class="text-red-500">無法讀取新聞資料</p>';
  }
}