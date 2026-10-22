const WORKER_API_BASE = "https://your-worker-name.your-subdomain.workers.dev";

document.addEventListener('DOMContentLoaded', function() {
  // 註冊 PWA Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js');
  }

  const calendarEl = document.getElementById('calendar');
  const calendar = new FullCalendar.Calendar(calendarEl, {
    initialView: 'dayGridMonth',
    locale: 'zh-tw',
    events: async function(fetchInfo, successCallback, failureCallback) {
      const monthStr = fetchInfo.startStr.slice(0, 7);
      try {
        const res = await fetch(`${WORKER_API_BASE}/api/month-events?month=${monthStr}`);
        const data = await res.json();
        const events = data.map(item => ({
          title: `[${item.category}] ${item.title}`,
          start: item.event_date,
          backgroundColor: item.category.includes('財報') ? '#2563eb' : '#dc2626'
        }));
        successCallback(events);
      } catch (e) {
        failureCallback(e);
      }
    },
    // 點擊日期格時查詢該日 5 則新聞
    dateClick: async function(info) {
      loadDailyNews(info.dateStr);
    }
  });

  calendar.render();
});

async function loadDailyNews(dateStr) {
  const container = document.getElementById('news-section');
  const title = document.getElementById('selected-date-title');
  const list = document.getElementById('news-list');

  title.innerText = `${dateStr} 當日焦點新聞`;
  list.innerHTML = '<p class="text-gray-500">載入中...</p>';
  container.classList.remove('hidden');

  try {
    const res = await fetch(`${WORKER_API_BASE}/api/daily-news?date=${dateStr}`);
    const news = await res.json();

    if (news.length === 0) {
      list.innerHTML = '<p class="text-gray-400">當日尚無記錄或非交易日。</p>';
      return;
    }

    list.innerHTML = news.map((n, idx) => `
      <div class="border-b pb-3">
        <h3 class="font-semibold text-lg text-slate-900">${idx + 1}. ${n.title}</h3>
        <p class="text-slate-600 text-sm mt-1">${n.summary}</p>
        ${n.impact_tickers ? `<span class="inline-block mt-2 px-2 py-0.5 bg-blue-100 text-blue-800 text-xs rounded font-medium">相關標的: ${n.impact_tickers}</span>` : ''}
      </div>
    `).join('');
  } catch (err) {
    list.innerHTML = '<p class="text-red-500">無法讀取新聞資料</p>';
  }
}