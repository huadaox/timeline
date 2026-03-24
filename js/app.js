/**
 * app.js - Main application logic: data loading, filters, events
 */
const App = (() => {
  let games = [];
  let filters = {
    tier: 'all',
    platform: 'all',
    search: ''
  };

  async function init() {
    try {
      const res = await fetch('data/games.json');
      if (!res.ok) throw new Error('Failed to load game data');
      const data = await res.json();
      games = data.games;

      Timeline.initDragScroll();
      render();
      bindEvents();

      // Scroll to recent content after rendering
      setTimeout(() => {
        Timeline.scrollToToday();
        hideLoading();
      }, 100);
    } catch (err) {
      console.error('Error loading data:', err);
      hideLoading();
      document.getElementById('timeline-content').innerHTML =
        '<p style="color: var(--text-dim); padding: 40px; text-align: center;">数据加载失败，请确认 data/games.json 文件存在。</p>';
    }
  }

  function render() {
    Timeline.renderAxis();
    Timeline.renderCards(games, filters);
  }

  function hideLoading() {
    const loading = document.getElementById('loading');
    loading.classList.add('fade-out');
    setTimeout(() => loading.remove(), 300);
  }

  function bindEvents() {
    // Tier filter buttons
    document.querySelectorAll('.filter-btn[data-tier]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn[data-tier]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        filters.tier = btn.dataset.tier;
        render();
      });
    });

    // Platform filter buttons
    document.querySelectorAll('.filter-btn[data-platform]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn[data-platform]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        filters.platform = btn.dataset.platform;
        render();
      });
    });

    // Search
    const searchInput = document.getElementById('search-input');
    const searchClear = document.getElementById('search-clear');
    let searchDebounce = null;

    searchInput.addEventListener('input', () => {
      clearTimeout(searchDebounce);
      const val = searchInput.value.trim();
      searchClear.hidden = !val;

      searchDebounce = setTimeout(() => {
        filters.search = val;
        render();

        // If searching, find first match and scroll to it
        if (val) {
          const match = games.find(g =>
            g.title.toLowerCase().includes(val.toLowerCase())
          );
          if (match) {
            setTimeout(() => Timeline.highlightCard(match.id), 100);
          }
        }
      }, 250);
    });

    searchClear.addEventListener('click', () => {
      searchInput.value = '';
      searchClear.hidden = true;
      filters.search = '';
      render();
    });

    // Zoom buttons
    document.getElementById('zoom-in').addEventListener('click', () => {
      Timeline.setZoom(Timeline.getZoom() + 0.2);
    });

    document.getElementById('zoom-out').addEventListener('click', () => {
      Timeline.setZoom(Timeline.getZoom() - 0.2);
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.key === '/' && !e.ctrlKey && document.activeElement !== searchInput) {
        e.preventDefault();
        searchInput.focus();
      }
      if (e.key === 'Escape') {
        searchInput.blur();
        searchInput.value = '';
        searchClear.hidden = true;
        filters.search = '';
        render();
      }
    });

    // Handle window resize
    let resizeDebounce = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeDebounce);
      resizeDebounce = setTimeout(render, 200);
    });
  }

  return { init, render };
})();

// Start
document.addEventListener('DOMContentLoaded', App.init);
