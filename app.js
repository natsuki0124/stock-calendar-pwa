export default {
  // 1. 定時排程觸發 (Cron: 每日自動執行)
  async scheduled(event, env, ctx) {
    ctx.waitUntil(fetchAndSaveDailyMarketInfo(env));
  },

  // 2. 請求處理 (前端首頁 + API 路由)
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // API: 手動同步觸發
    if (url.pathname === "/api/trigger-sync") {
      try {
        const result = await fetchAndSaveDailyMarketInfo(env);
        return new Response(JSON.stringify({ success: true, message: "資料已成功透過 Gemini 同步寫入！", data: result }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      } catch (err) {
        return new Response(JSON.stringify({ success: false, error: err.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    // API: 取得特定月份的所有行事曆
    if (url.pathname === "/api/month-events") {
      const month = url.searchParams.get("month") || new Date().toISOString().slice(0, 7);
      const events = await env.DB.prepare(
        "SELECT * FROM economic_events WHERE event_date LIKE ? ORDER BY event_date ASC"
      ).bind(`${month}%`).all();

      return new Response(JSON.stringify(events.results || []), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // API: 取得特定日期的詳細新聞
    if (url.pathname === "/api/daily-news") {
      const date = url.searchParams.get("date") || new Date().toISOString().split('T')[0];
      const news = await env.DB.prepare(
        "SELECT * FROM daily_news WHERE date = ? ORDER BY id ASC"
      ).bind(date).all();

      return new Response(JSON.stringify(news.results || []), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 首頁：直接回傳整合前端 HTML
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(renderHTML(), {
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });
    }

    return new Response("Not Found", { status: 404 });
  }
};

// 呼叫 Gemini 3.8 Flash 並寫入 D1（含 503 自動重試與備援）
async function fetchAndSaveDailyMarketInfo(env) {
  if (!env.GEMINI_API_KEY) throw new Error("找不到 GEMINI_API_KEY，請在 Settings > Variables 進行設定。");
  if (!env.DB) throw new Error("找不到 D1 資料庫綁定 DB，請在 Settings > Bindings 進行設定。");

  const today = new Date().toISOString().split('T')[0];
  const prompt = `
  今天是 ${today}。請以專業美股分析師角度，輸出今日盤勢與近期重要財經事件。
  請直接且嚴格以純 JSON 格式回應（不要加上 markdown 程式碼區塊標記，不要輸出額外文字），結構需包含：
  {
    "news": [
      {
        "title": "新聞標題",
        "summary": "100字內重點摘要",
        "impact_tickers": "相關股票代碼例如 NVDA, TSLA"
      }
    ],
    "events": [
      {
        "event_date": "YYYY-MM-DD",
        "category": "財報公布 / 利率決議 / 總經數據",
        "title": "事件簡稱，例如: 輝達財報公布"
      }
    ]
  }
  注意：news 需有 5 則，events 需列出近期本週至本月確認的重要事件。
  `;

  const models = ["gemini-3.8-flash", "gemini-2.5-flash"];
  let geminiData = null;
  let lastError = null;

  for (const model of models) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;
    
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }]
          })
        });

        if (res.ok) {
          geminiData = await res.json();
          break;
        } else {
          const errText = await res.text();
          lastError = errText;
          if (res.status === 503) {
            await new Promise((r) => setTimeout(r, 1000));
            continue;
          }
        }
      } catch (e) {
        lastError = e.message;
      }
    }

    if (geminiData) break;
  }

  if (!geminiData) {
    throw new Error(`Gemini 模型暫時忙碌中，請稍候重試: ${lastError}`);
  }

  let rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
  rawText = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();

  let content;
  try {
    content = JSON.parse(rawText);
  } catch (e) {
    throw new Error(`Gemini 回傳非合法 JSON: ${rawText}`);
  }

  // 寫入新聞到 D1
  if (content.news && Array.isArray(content.news)) {
    for (const item of content.news) {
      await env.DB.prepare(
        "INSERT INTO daily_news (date, title, summary, impact_tickers) VALUES (?, ?, ?, ?)"
      ).bind(today, item.title, item.summary, item.impact_tickers).run();
    }
  }

  // 寫入行事曆到 D1
  if (content.events && Array.isArray(content.events)) {
    for (const ev of content.events) {
      await env.DB.prepare(
        "INSERT INTO economic_events (event_date, category, title) VALUES (?, ?, ?)"
      ).bind(ev.event_date, ev.category, ev.title).run();
    }
  }

  return content;
}

// 內嵌前端介面 HTML
function renderHTML() {
  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>美股重點觀測曆</title>
  <script src="https://cdn.jsdelivr.net/npm/fullcalendar@6.1.10/index.global.min.js"></script>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    .fc-event { cursor: pointer; padding: 2px 4px; font-size: 0.8rem; }
    .fc-daygrid-day { cursor: pointer; }
    .fc-daygrid-day:hover { background-color: #f8fafc; }
  </style>
</head>
<body class="bg-slate-100 text-slate-800 p-4 md:p-8">
  <div class="max-w-4xl mx-auto space-y-6">
    <header class="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
      <div>
        <h1 class="text-2xl font-bold text-slate-900 tracking-tight">美股重點觀測曆</h1>
        <p class="text-sm text-slate-500 mt-1">每日 Gemini 自動追蹤五大焦點與重要財經排程</p>
      </div>
      <button onclick="triggerSync()" id="sync-btn" class="mt-4 sm:mt-0 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl shadow transition active:scale-95">
        手動更新資訊
      </button>
    </header>

    <!-- 月曆區域 -->
    <div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
      <div id="calendar"></div>
    </div>

    <!-- 當日新聞展示區 -->
    <div id="news-section" class="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
      <div class="flex items-center justify-between border-b pb-4 mb-4">
        <h2 id="selected-date-title" class="text-xl font-bold text-slate-900">當日重點新聞</h2>
        <span class="text-xs text-blue-600 bg-blue-50 px-2.5 py-1 rounded-full font-medium">點選任一日曆格子查看</span>
      </div>
      <div id="news-list" class="space-y-4">
        <p class="text-gray-400 text-sm">請點選月曆上的日期查看該日 5 則焦點新聞。</p>
      </div>
    </div>
  </div>

  <script>
    let calendar;

    document.addEventListener('DOMContentLoaded', function() {
      const calendarEl = document.getElementById('calendar');
      calendar = new FullCalendar.Calendar(calendarEl, {
        initialView: 'dayGridMonth',
        locale: 'zh-tw',
        headerToolbar: {
          left: 'prev,next today',
          center: 'title',
          right: ''
        },
        events: async function(fetchInfo, successCallback, failureCallback) {
          try {
            const date = calendar.getDate();
            const yearMonth = date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0');
            const res = await fetch('/api/month-events?month=' + yearMonth);
            const data = await res.json();
            
            const events = (data || []).map(item => ({
              title: item.title,
              start: item.event_date,
              backgroundColor: item.category.includes('財報') ? '#2563eb' : (item.category.includes('數據') ? '#059669' : '#dc2626'),
              borderColor: 'transparent'
            }));
            successCallback(events);
          } catch (e) {
            failureCallback(e);
          }
        },
        dateClick: function(info) {
          loadDailyNews(info.dateStr);
        }
      });
      calendar.render();

      const today = new Date().toISOString().split('T')[0];
      loadDailyNews(today);
    });

    async function loadDailyNews(dateStr) {
      const title = document.getElementById('selected-date-title');
      const list = document.getElementById('news-list');
      title.innerText = dateStr + ' 美股焦點新聞';
      list.innerHTML = '<p class="text-gray-400 text-sm">載入中...</p>';

      try {
        const res = await fetch('/api/daily-news?date=' + dateStr);
        const news = await res.json();
        if (!news || news.length === 0) {
          list.innerHTML = '<p class="text-gray-400 text-sm">當天尚無新聞記錄。</p>';
          return;
        }
        list.innerHTML = news.map((n, i) => \`
          <div class="border-b border-slate-100 pb-4 last:border-b-0">
            <h3 class="font-semibold text-slate-800 text-base mb-1">\${i + 1}. \${n.title}</h3>
            <p class="text-slate-600 text-sm leading-relaxed">\${n.summary}</p>
            \${n.impact_tickers ? \`<span class="inline-block mt-2 px-2 py-0.5 bg-blue-50 text-blue-700 text-xs rounded font-medium border border-blue-100">標的: \${n.impact_tickers}</span>\` : ''}
          </div>
        \`).join('');
      } catch (e) {
        list.innerHTML = '<p class="text-red-500 text-sm">新聞載入失敗</p>';
      }
    }

    async function triggerSync() {
      const btn = document.getElementById('sync-btn');
      btn.disabled = true;
      btn.innerText = '更新中...';
      try {
        const res = await fetch('/api/trigger-sync');
        const data = await res.json();
        if (data.success) {
          alert('同步成功！');
          calendar.refetchEvents();
          const today = new Date().toISOString().split('T')[0];
          loadDailyNews(today);
        } else {
          alert('同步失敗: ' + data.error);
        }
      } catch (e) {
        alert('網路請求失敗: ' + e.message);
      } finally {
        btn.disabled = false;
        btn.innerText = '手動更新資訊';
      }
    }
  </script>
</body>
</html>`;
}