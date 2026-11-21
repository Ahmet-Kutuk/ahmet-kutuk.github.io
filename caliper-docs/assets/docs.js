/*
  Caliper documentation: search (/ or Ctrl K), the "On this page" marker,
  the phone menu, light and dark, copy buttons and screenshot zoom.
*/
(function () {
  const root = document.documentElement;

  /* Light and dark: follows the device until the reader picks one. */
  const toggle = document.querySelector('[data-theme-toggle]');
  const isDark = () => root.dataset.theme === 'dark' || (root.dataset.theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  toggle?.addEventListener('click', () => {
    const next = isDark() ? 'light' : 'dark';
    root.dataset.theme = next;
    try {
      localStorage.setItem('docs-theme', next);
    } catch (error) {
      /* storage blocked */
    }
  });

  /* Phone menu: a tray from the left with a scrim. */
  const sidebar = document.getElementById('Sidebar');
  const opener = document.querySelector('[data-nav-open]');
  let scrim = null;
  const setNav = (open) => {
    sidebar.classList.toggle('is-open', open);
    opener?.setAttribute('aria-expanded', String(open));
    if (open) {
      scrim = document.createElement('div');
      scrim.className = 'scrim';
      scrim.addEventListener('click', () => setNav(false));
      document.body.appendChild(scrim);
      sidebar.querySelector('[aria-current="page"], a')?.focus();
    } else {
      scrim?.remove();
      scrim = null;
    }
  };
  opener?.addEventListener('click', () => setNav(true));
  document.querySelector('[data-nav-close]')?.addEventListener('click', () => {
    setNav(false);
    opener?.focus();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && sidebar?.classList.contains('is-open')) {
      setNav(false);
      opener?.focus();
    }
  });
  sidebar?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'center' });

  /* "On this page": marks the section being read. */
  const tocLinks = Array.from(document.querySelectorAll('.toc a'));
  if (tocLinks.length && 'IntersectionObserver' in window) {
    const targets = tocLinks.map((a) => document.getElementById(decodeURIComponent(a.hash.slice(1)))).filter(Boolean);
    const visible = new Set();
    const mark = () => {
      const first = targets.find((t) => visible.has(t)) || targets.filter((t) => t.getBoundingClientRect().top < 120).pop();
      tocLinks.forEach((a) => a.classList.toggle('is-current', Boolean(first) && a.hash === `#${first.id}`));
    };
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => (entry.isIntersecting ? visible.add(entry.target) : visible.delete(entry.target)));
      mark();
    }, { rootMargin: '-72px 0px -60% 0px' });
    targets.forEach((t) => observer.observe(t));
  }

  /* Copy buttons on code blocks. */
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-copy]');
    if (!button) return;
    const code = button.parentElement.querySelector('code')?.textContent || '';
    navigator.clipboard?.writeText(code).then(() => {
      const label = button.querySelector('span');
      label.textContent = 'Copied';
      setTimeout(() => { label.textContent = 'Copy'; }, 1600);
    }).catch(() => {});
  });

  /* Screenshot zoom. */
  let zoom = null;
  document.addEventListener('click', (event) => {
    const link = event.target.closest('[data-zoom]');
    if (!link || event.metaKey || event.ctrlKey) return;
    event.preventDefault();
    if (!zoom) {
      zoom = document.createElement('dialog');
      zoom.className = 'zoom';
      zoom.setAttribute('aria-label', 'Screenshot');
      zoom.addEventListener('click', () => zoom.close());
      document.body.appendChild(zoom);
    }
    const img = link.querySelector('img');
    zoom.innerHTML = '';
    const big = document.createElement('img');
    big.src = link.getAttribute('href');
    big.alt = img?.alt || '';
    zoom.appendChild(big);
    zoom.showModal();
  });

  /* Support form without a form service: opens a prefilled request. */
  document.querySelector('[data-issue-form]')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const f = new FormData(event.target);
    const body = `**Theme:** ${f.get('theme')}\n**Store:** ${f.get('store_url')}\n**Topic:** ${f.get('topic')}\n**Name:** ${f.get('name')}\n\n${f.get('problem')}`;
    const url = new URL(event.target.action);
    url.searchParams.set('title', `[${f.get('topic')}] ${String(f.get('problem')).split('\n')[0].slice(0, 80)}`);
    url.searchParams.set('body', body);
    url.searchParams.set('labels', 'support');
    window.location.href = url.toString();
  });

  /* Search: every page, section, setting and block, ranked by where the
     words appear (title first, then the text). */
  const dialog = document.querySelector('.search');
  const input = dialog?.querySelector('[data-search-input]');
  const list = dialog?.querySelector('[data-search-results]');
  const empty = dialog?.querySelector('[data-search-empty]');
  let index = null;
  let results = [];
  let active = -1;

  const load = () => {
    if (index) return Promise.resolve(index);
    return fetch('assets/search-index.json').then((r) => r.json()).then((data) => {
      index = data.map((e) => ({ ...e, lt: e.t.toLowerCase(), lx: e.x.toLowerCase(), lp: e.pt.toLowerCase() }));
      return index;
    });
  };

  const escape = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const highlight = (text, words) => {
    let out = escape(text);
    words.forEach((w) => {
      if (w.length < 2) return;
      out = out.replace(new RegExp(`(${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'), '<mark>$1</mark>');
    });
    return out;
  };
  const snippet = (text, words) => {
    const lower = text.toLowerCase();
    const at = Math.max(0, Math.min(...words.map((w) => { const i = lower.indexOf(w); return i < 0 ? Infinity : i; })));
    const start = Number.isFinite(at) ? Math.max(0, at - 40) : 0;
    return (start > 0 ? '…' : '') + text.slice(start, start + 170);
  };

  const run = () => {
    const query = input.value.trim().toLowerCase();
    const words = query.split(/\s+/).filter(Boolean);
    if (!words.length) {
      list.innerHTML = '';
      empty.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      return;
    }
    results = index
      .map((e) => {
        let score = 0;
        for (const w of words) {
          const inTitle = e.lt.includes(w);
          const inText = e.lx.includes(w);
          const inPage = e.lp.includes(w);
          if (!inTitle && !inText && !inPage) return null;
          score += (inTitle ? 10 : 0) + (e.lt.startsWith(w) ? 4 : 0) + (inPage ? 3 : 0) + (inText ? 1 : 0);
        }
        return { e, score };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12);
    list.innerHTML = results.map(({ e }, i) => `
      <li><a href="${e.p}${e.id ? `#${e.id}` : ''}" id="sr-${i}" role="option" aria-selected="false">
        <span class="search__where">${escape(e.g)} · ${escape(e.pt)}</span>
        <span class="search__title">${highlight(e.t, words)}</span>
        ${e.x ? `<span class="search__snippet">${highlight(snippet(e.x, words), words)}</span>` : ''}
      </a></li>`).join('');
    empty.hidden = results.length > 0;
    input.setAttribute('aria-expanded', String(results.length > 0));
    select(results.length ? 0 : -1);
  };

  const select = (i) => {
    active = i;
    list.querySelectorAll('a').forEach((a, n) => a.setAttribute('aria-selected', String(n === i)));
    if (i >= 0) {
      input.setAttribute('aria-activedescendant', `sr-${i}`);
      list.querySelector(`#sr-${i}`)?.scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  };

  const open = () => {
    if (!dialog || dialog.open) return;
    dialog.showModal();
    input.focus();
    input.select();
    load().then(run);
  };

  document.querySelectorAll('[data-search-open]').forEach((b) => b.addEventListener('click', open));
  document.addEventListener('keydown', (event) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
    if ((event.key === '/' && !typing) || (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey))) {
      event.preventDefault();
      open();
    }
  });
  input?.addEventListener('input', () => load().then(run));
  input?.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' && results.length) {
      event.preventDefault();
      select((active + 1) % results.length);
    } else if (event.key === 'ArrowUp' && results.length) {
      event.preventDefault();
      select((active - 1 + results.length) % results.length);
    } else if (event.key === 'Enter' && active >= 0) {
      event.preventDefault();
      list.querySelector(`#sr-${active}`)?.click();
    }
  });
  dialog?.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
    if (event.target.closest('.search__results a')) dialog.close();
  });
  const shortcut = document.querySelector('[data-shortcut]');
  if (shortcut && /Mac|iPhone|iPad/.test(navigator.platform)) shortcut.textContent = '⌘K';
  else if (shortcut) shortcut.textContent = 'Ctrl K';
})();
