(function () {
  'use strict';
  const { FS } = window;
  const $ = (id) => document.getElementById(id);

  FS.langPicker($('lang'), () => { loadDemoWorkers(); });
  FS.applyI18n();

  const dest = (role) => (role === 'admin' ? '/admin.html' : '/worker.html');

  async function signIn(payload) {
    const err = $('login-error');
    err.hidden = true;
    try {
      const out = await FS.api('POST', '/api/login', payload);
      FS.session.save(out.token, out.role);
      // Workers keep the language they chose here; first-time workers get their saved preference.
      window.location.href = dest(out.role);
    } catch (e) {
      err.textContent = FS.errText(e);
      err.hidden = false;
    }
  }

  $('login-form').addEventListener('submit', (e) => {
    e.preventDefault();
    signIn({ id: $('uid').value.trim().toUpperCase(), pin: $('pin').value });
  });

  // ---- Demo access (only offered when the server runs with DEMO_MODE=true) ----
  async function loadDemoWorkers() {
    const select = $('demo-worker');
    if ($('demo').hidden) return;
    const prev = select.value;
    const workers = await FS.api('GET', '/api/demo/workers');
    select.replaceChildren(
      ...workers.map((w) => FS.h('option', { value: w.id, text: `${w.name} · ${w.role} · ${FS.t('sector_' + w.sector)}` })),
    );
    if (prev) select.value = prev;
  }

  FS.api('GET', '/api/config').then((cfg) => {
    if (!cfg.demoMode) return;
    $('demo').hidden = false;
    loadDemoWorkers();
  });
  $('demo-worker-btn').addEventListener('click', () => signIn({ demo: 'worker', id: $('demo-worker').value }));
  $('demo-admin-btn').addEventListener('click', () => signIn({ demo: 'admin' }));

  // ---- Anonymous report tracking ----
  $('track-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const box = $('track-result');
    try {
      const r = await FS.api('GET', `/api/reports/track/${encodeURIComponent($('track-code').value.trim())}`);
      box.replaceChildren(
        FS.h('p', {}, FS.h('strong', { text: r.code + ' · ' }), FS.t('cat_' + r.category), ' · ', FS.h('span', { class: 'badge info', text: FS.t('status_' + r.status) })),
        FS.h('ul', {}, r.history.map((h) => FS.h('li', { text: `${FS.dateTime(h.at)} – ${FS.t('status_' + h.status)}` }))),
      );
    } catch (err) {
      box.replaceChildren(FS.h('p', { class: 'alert critical', text: FS.errText(err) }));
    }
  });
})();
