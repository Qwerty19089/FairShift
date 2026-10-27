(function () {
  'use strict';
  const { FS } = window;
  const { h, t } = FS;
  const $ = (id) => document.getElementById(id);

  if (FS.session.role !== 'admin') { window.location.href = '/'; return; }

  const SECTORS = ['construction', 'college', 'hospital', 'factory'];
  let sector = '';
  let dash = null;

  const q = () => (sector ? `?sector=${sector}` : '');
  const badge = (cls, text) => h('span', { class: `badge ${cls}`, text });

  async function guarded(fn) {
    try { return await fn(); } catch (e) { FS.toast(FS.errText(e), 'error'); return null; }
  }

  // ---- KPIs ---------------------------------------------------------------
  function renderKpis(k) {
    const tile = (label, value, tone) => h('div', { class: `kpi ${tone || ''}` }, h('div', { class: 'label', text: label }), h('div', { class: 'value', text: String(value) }));
    $('kpis').replaceChildren(
      tile(t('a_workers'), k.workers),
      tile(t('a_present'), k.presentToday),
      tile(t('a_onshift'), k.onShiftNow),
      tile(t('a_ot7'), k.overtimeHours7d, k.overtimeHours7d > 40 ? 'alert-warn' : ''),
      tile(t('a_hazards'), k.openHazards, k.openHazards ? 'alert-crit' : 'alert-ok'),
      tile(t('a_fatigue'), k.fatigueAlerts, k.fatigueAlerts ? 'alert-warn' : 'alert-ok'),
      tile(t('a_highrisk'), k.highRisk, k.highRisk ? 'alert-crit' : 'alert-ok'));
  }

  // ---- Attendance chart (bars + an equivalent table for screen readers) ----
  function renderAttendance(points, workers) {
    const max = Math.max(workers, ...points.map((p) => p.present), 1);
    const summary = points.map((p) => `${p.date}: ${p.present}`).join(', ');
    $('attendance').replaceChildren(
      h('div', { class: 'bars', role: 'img', 'aria-label': `${t('a_attendance')}. ${summary}` },
        points.map((p) => h('div', { class: 'bar', style: `height:${Math.round((p.present / max) * 100)}%`, title: `${p.date}: ${p.present}` }, h('span', { text: String(p.present) })))),
      h('div', { class: 'bar-labels', 'aria-hidden': 'true' }, points.map((p) => h('span', { text: p.date.slice(8) }))));
  }

  // ---- Feedback (k-anonymity: hidden until enough responses) ----------------
  function renderFeedback(list) {
    $('feedback').replaceChildren(...list.map((f) => h('div', { style: 'margin-bottom:1rem' },
      h('h3', { text: f.siteName }),
      f.hidden
        ? h('p', { class: 'alert warning', text: '🔒 ' + t('a_hidden', { n: f.minGroup, c: f.count }) })
        : [
            ...['manager', 'conditions', 'safety'].map((k) => h('div', { style: 'margin-bottom:.4rem' },
              h('div', { class: 'row between small' }, h('span', { text: t('a_' + k) }), h('strong', { text: `${f.averages[k]} / 5` })),
              h('div', { class: 'meter', role: 'meter', 'aria-valuemin': 0, 'aria-valuemax': 5, 'aria-valuenow': f.averages[k], 'aria-label': t('a_' + k) },
                h('div', { style: `width:${(f.averages[k] / 5) * 100}%`, class: '' })))),
            f.comments.length ? h('details', {}, h('summary', { text: `💬 ${f.comments.length}` }), h('ul', {}, f.comments.map((c) => h('li', { text: c })))) : null,
          ])));
  }

  // ---- People needing attention (fatigue + quit-risk, explained) ------------
  function factorText(f) {
    if (f.key === 'fatigue') return `${t('a_f_fatigue')}: ${f.detail.level}`;
    return t('a_f_' + f.key, f.detail);
  }

  function renderPeople(people, sites) {
    const siteName = (id) => (sites.find((s) => s.id === id) || {}).name || id;
    $('people').replaceChildren(h('table', {},
      h('thead', {}, h('tr', {}, ['a_name', 'a_site', 'a_fatigue_col', 'a_risk', 'a_why'].map((k) => h('th', { scope: 'col', text: t(k) })))),
      h('tbody', {}, people.map((p) => h('tr', {},
        h('td', {}, h('strong', { text: p.name }), h('div', { class: 'muted small', text: `${p.id} · ${p.role}` })),
        h('td', {}, siteName(p.siteId), h('div', { class: 'muted small', text: t('sector_' + p.sector) })),
        h('td', {}, badge(p.fatigueLevel, t('a_level_' + p.fatigueLevel)),
          p.fatigueFlags.map((f) => h('div', { class: 'small', text: t('fatigue_' + f.code, { v: FS.hrs(f.value) }) }))),
        h('td', {}, badge(p.risk.band, `${p.risk.score} · ${t('a_band_' + p.risk.band)}`)),
        h('td', { class: 'small' }, p.risk.factors.length ? h('ul', { style: 'margin:0;padding-left:1.1rem' }, p.risk.factors.map((f) => h('li', { text: `${factorText(f)} (+${f.points})` }))) : '—'))))));
  }

  // ---- Safety reports with status tracking ------------------------------------
  async function renderReports() {
    const reports = await FS.api('GET', `/api/admin/reports${q()}`);
    if (!reports.length) return $('reports').replaceChildren(h('p', { class: 'muted', text: t('a_none') }));
    $('reports').replaceChildren(h('table', {},
      h('thead', {}, h('tr', {}, ['a_tracking', 'a_site', 'a_status'].map((k) => h('th', { scope: 'col', text: t(k) })), h('th', { scope: 'col', text: t('a_update') }))),
      h('tbody', {}, reports.map((r) => {
        const select = h('select', { 'aria-label': `${t('a_status')} ${r.code}`, style: 'min-height:44px;width:auto' },
          ['open', 'in_review', 'resolved'].map((s) => h('option', { value: s, text: t('status_' + s), selected: s === r.status })));
        return h('tr', {},
          h('td', {}, h('strong', { text: r.code }), h('div', { class: 'small' }, badge(r.severity, t('sev_' + r.severity)), ' ', t('cat_' + r.category)),
            h('div', { class: 'muted small', text: `${FS.dateTime(r.createdAt)} · ${r.anonymous ? t('a_anonymous') : t('a_named')}` })),
          h('td', {}, r.siteName, h('div', { class: 'small', text: r.description })),
          h('td', {}, badge(r.status === 'resolved' ? 'ok' : r.status === 'open' ? 'critical' : 'warning', t('status_' + r.status))),
          h('td', {}, select, ' ', h('button', { class: 'small', type: 'button', onclick: async () => {
            const ok = await guarded(() => FS.api('PATCH', `/api/admin/reports/${r.id}`, { status: select.value }));
            if (ok) { FS.toast(t('a_saved')); load(); }
          } }, t('a_update'))));
      }))));
  }

  // ---- Skill passport (issue + verify) ------------------------------------------
  async function renderPassportList() {
    const id = $('pp-worker').value;
    if (!id) return;
    const w = await FS.api('GET', `/api/admin/workers/${id}`);
    $('pp-list').replaceChildren(...(w.credentials.length ? w.credentials.map((c) => h('div', { class: 'row between', style: 'padding:.4rem 0;border-bottom:1px solid var(--line)' },
      h('div', {}, h('strong', { text: c.title }), h('div', { class: 'muted small', text: `${c.issuer} · ${c.issuedOn}${c.expiresOn ? ' → ' + c.expiresOn : ''}` })),
      c.verified ? badge('ok', '✔ ' + t('verified'))
        : h('button', { class: 'small', type: 'button', onclick: async () => { await guarded(() => FS.api('PATCH', `/api/admin/credentials/${c.id}/verify`)); renderPassportList(); } }, `${t('a_verify')}: ${t('a_unverified')}`))) : [h('p', { class: 'muted', text: t('pp_empty') })]));
  }

  $('pp-worker').addEventListener('change', renderPassportList);
  $('pp-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const ok = await guarded(() => FS.api('POST', '/api/admin/credentials', {
      workerId: $('pp-worker').value, title: $('c-title').value, issuer: $('c-issuer').value, issuedOn: $('c-date').value, expiresOn: $('c-exp').value || null,
    }));
    if (ok) { e.target.reset(); FS.toast(t('a_saved')); renderPassportList(); }
  });

  // ---- Site QR codes (workers scan to check in) -----------------------------------
  function renderSites(sites) {
    $('qr-sites').replaceChildren(...sites.map((s) => {
      const holder = h('div', { class: 'qr' });
      return h('div', { class: 'card', style: 'margin:0' },
        h('strong', { text: s.name }), h('div', { class: 'muted small', text: `${t('sector_' + s.sector)} · ${s.code}` }),
        holder,
        h('button', { class: 'secondary small', type: 'button', onclick: async () => {
          const qr = await guarded(() => FS.api('GET', `/api/admin/sites/${s.id}/qr`));
          if (qr) holder.replaceChildren(h('img', { src: qr.dataUrl, alt: `QR ${qr.code}`, width: 220, height: 220 }), h('div', { class: 'code-box', text: qr.code }),
            h('div', {}, h('button', { class: 'secondary small no-print', type: 'button', onclick: () => window.print() }, t('a_print'))));
        } }, t('a_show_qr')));
    }));
  }

  // ---- Load everything ----------------------------------------------------------
  async function load() {
    dash = await FS.api('GET', `/api/admin/dashboard${q()}`);
    $('updated').textContent = FS.dateTime(dash.generatedAt);
    renderKpis(dash.kpis);
    renderAttendance(dash.attendance, dash.kpis.workers);
    renderFeedback(dash.feedback);
    renderPeople(dash.people, dash.sites);
    renderSites(dash.sites);

    const select = $('pp-worker');
    const prev = select.value;
    select.replaceChildren(...dash.people.map((p) => h('option', { value: p.id, text: `${p.name} (${p.id})` })));
    if (prev && dash.people.some((p) => p.id === prev)) select.value = prev;
    renderPassportList();
    await renderReports();
  }

  function buildSectorSelect() {
    const select = $('sector');
    select.replaceChildren(h('option', { value: '', text: t('a_all') }), ...SECTORS.map((s) => h('option', { value: s, text: t('sector_' + s), selected: s === sector })));
    select.value = sector;
  }
  $('sector').addEventListener('change', (e) => { sector = e.target.value; load(); });
  $('logout').addEventListener('click', FS.logout);

  FS.langPicker($('lang'), () => { buildSectorSelect(); load(); });
  FS.applyI18n();
  buildSectorSelect();
  load().catch((e) => FS.toast(FS.errText(e), 'error'));
})();
