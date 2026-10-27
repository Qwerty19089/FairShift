(function () {
  'use strict';
  const { FS } = window;
  const { h, t } = FS;

  if (FS.session.role !== 'worker') { window.location.href = '/'; return; }

  const view = document.getElementById('view');
  const tabs = Array.from(document.querySelectorAll('#tabs [role="tab"]'));
  let me = null;
  let current = 'shift';

  const CATEGORY_ICONS = { fall: '🧗', electrical: '⚡', fire: '🔥', machinery: '⚙️', chemical: '🧪', slip: '💧', equipment: '🔧', other: '❓' };
  const SEVERITY_ICONS = { low: '🟢', medium: '🟠', high: '🔴' };

  // ---- Small UI helpers -----------------------------------------------------
  const listenButton = (getText) =>
    FS.canSpeak ? h('button', { type: 'button', class: 'secondary small', onclick: () => FS.speak(getText()) }, '🔊 ', t('listen')) : null;

  const choice = (name, value, icon, label, checked) =>
    h('label', { class: 'choice' },
      h('input', { type: 'radio', name, value, checked: checked || null, required: true }),
      h('span', {}, h('span', { class: 'ico', 'aria-hidden': 'true', text: icon }), h('span', { text: label })));

  async function guarded(fn) {
    try { return await fn(); } catch (e) { FS.toast(FS.errText(e), 'error'); return null; }
  }

  // ---- Tab: Shift tracking + fatigue alerts ---------------------------------
  async function renderShift() {
    me = await FS.api('GET', '/api/worker/me');
    const shifts = await FS.api('GET', '/api/worker/shifts');
    const onShift = Boolean(me.openShift);

    const status = h('div', { class: 'card' },
      h('h1', { text: t('hello', { name: me.name }) }),
      h('p', { class: 'muted', text: `${me.role} · ${me.site.name}` }),
      h('p', {}, h('span', { class: `badge ${onShift ? 'ok' : 'info'}`, text: onShift ? t('on_shift') : t('off_shift') }),
        onShift ? ` ${t('hours_so_far', { h: FS.hrs(me.openShift.hoursSoFar) })}` : ''));

    const action = onShift ? checkoutCard() : checkinCard();

    const fatigue = h('div', { class: 'card' },
      h('h2', { text: '😴 ' + t('fatigue_title') }),
      me.fatigue.flags.length
        ? [...me.fatigue.flags.map((f) => h('div', { class: `alert ${f.level}`, text: t('fatigue_' + f.code, { v: FS.hrs(f.value) }) })),
           h('p', { class: 'muted small', text: t('fatigue_advice') })]
        : h('div', { class: 'alert ok', text: t('fatigue_ok') }));

    const recent = h('div', { class: 'card' },
      h('h2', { text: t('recent_shifts') }),
      h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', { text: t('date') }), h('th', { class: 'num', text: t('hours') }), h('th', { class: 'num', text: t('overtime') }))),
        h('tbody', {}, shifts.slice(0, 7).map((s) => h('tr', {}, h('td', { text: FS.date(s.checkIn) }), h('td', { class: 'num', text: FS.hrs(s.total) }), h('td', { class: 'num', text: FS.hrs(s.overtime) })))))));

    view.replaceChildren(status, action, fatigue, recent);
  }

  function getPosition() {
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve({});
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
        () => resolve({}),
        { timeout: 4000, maximumAge: 60000 },
      );
    });
  }

  function checkinCard() {
    const input = h('input', { id: 'site-code', autocapitalize: 'characters', autocomplete: 'off', placeholder: 'MARINA' });
    const video = h('video', { class: 'scan', playsinline: true, muted: true, hidden: true, 'aria-hidden': 'true' });
    let stream = null;

    const stopScan = () => { if (stream) stream.getTracks().forEach((tr) => tr.stop()); stream = null; video.hidden = true; };
    const doCheckin = (code) => guarded(async () => {
      stopScan();
      const pos = await getPosition();
      const out = await FS.api('POST', '/api/worker/checkin', { code, ...pos });
      FS.toast(out.locationVerified === false ? `${t('checked_in_ok')} · ${t('location_off')}` : out.locationVerified ? `${t('checked_in_ok')} · ${t('location_ok')}` : t('checked_in_ok'));
      await renderShift();
    });

    async function scan() {
      if (!('BarcodeDetector' in window) || !navigator.mediaDevices) return FS.toast(t('scan_unsupported'), 'error');
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      } catch { return FS.toast(t('scan_unsupported'), 'error'); }
      video.srcObject = stream; video.hidden = false; await video.play();
      const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      const started = Date.now();
      const tick = async () => {
        if (!stream) return;
        const found = await detector.detect(video).catch(() => []);
        if (found.length) return doCheckin(found[0].rawValue);
        if (Date.now() - started > 30000) return stopScan();
        setTimeout(tick, 300);
      };
      tick();
    }

    return h('div', { class: 'card' },
      ('BarcodeDetector' in window) ? h('button', { class: 'big', type: 'button', onclick: scan }, '📷 ', t('scan_qr')) : null,
      video,
      h('div', { class: 'field', style: 'margin-top:1rem' }, h('label', { for: 'site-code', text: t('enter_code') }), input),
      h('button', { class: 'big', type: 'button', onclick: () => doCheckin(input.value) }, '✅ ', t('check_in')),
      h('p', { class: 'muted small', style: 'margin-top:.75rem', text: t('ot_auto') }));
  }

  function checkoutCard() {
    return h('div', { class: 'card' },
      h('button', { class: 'big danger', type: 'button', onclick: () => guarded(async () => {
        const out = await FS.api('POST', '/api/worker/checkout', await getPosition());
        FS.toast(t('checked_out_ok', { total: FS.hrs(out.total), ot: FS.hrs(out.overtime) }));
        await renderShift();
      }) }, '🏁 ', t('check_out')),
      h('p', { class: 'muted small', style: 'margin-top:.75rem', text: t('ot_auto') }));
  }

  // ---- Tab: Clear payslip, in the worker's language, read aloud on request ----
  async function renderPay(month) {
    const now = new Date(Date.now() + 5.5 * 3600 * 1000);
    const months = [0, 1, 2].map((i) => {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      return d.toISOString().slice(0, 7);
    });
    month = month || months[0];
    const slip = await FS.api('GET', `/api/worker/payslip?month=${month}`);

    const monthName = (m) => new Date(m + '-01T00:00:00Z').toLocaleDateString(FS.lang === 'en' ? 'en-IN' : `${FS.lang}-IN`, { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const select = h('select', { id: 'month', onchange: (e) => renderPay(e.target.value) },
      months.map((m) => h('option', { value: m, text: monthName(m), selected: m === month })));

    const line = (label, detail, amount, cls) =>
      h('tr', { class: cls }, h('td', {}, label, detail ? h('div', { class: 'muted small', text: detail }) : null), h('td', { class: 'num', text: FS.money(amount) }));

    const spoken = () => [
      t('pay_title'), monthName(month),
      `${t('net')}: ${t('rupees', { n: Math.round(slip.net) })}`,
      `${t('gross')}: ${t('rupees', { n: Math.round(slip.gross) })}`,
      `${t('overtime')}: ${FS.hrs(slip.hours.overtime)} ${t('hours')}`,
      `${t('deductions')}: ${t('rupees', { n: Math.round(slip.deductions) })}`,
    ].join('. ');

    view.replaceChildren(
      h('div', { class: 'card' },
        h('h1', { text: '💰 ' + t('pay_title') }),
        h('div', { class: 'field' }, h('label', { for: 'month', text: t('month') }), select),
        slip.days.length === 0
          ? h('p', { class: 'muted', text: t('no_shifts') })
          : [
              h('p', { class: 'muted', style: 'margin:0', text: t('net') }),
              h('div', { class: 'big-number', text: FS.money(slip.net) }),
              h('div', { style: 'margin:.75rem 0' }, listenButton(spoken)),
            ]),
      slip.days.length === 0 ? null : h('div', { class: 'card' },
        h('div', { class: 'table-wrap' }, h('table', {},
          h('tbody', {},
            line(t('regular_pay'), `${FS.hrs(slip.earnings[0].hours)} ${t('hours')} × ${FS.money(slip.earnings[0].rate)}`, slip.earnings[0].amount),
            line(t('overtime_pay'), `${FS.hrs(slip.earnings[1].hours)} ${t('hours')} × ${FS.money(slip.earnings[1].rate)}`, slip.earnings[1].amount),
            line(t('gross'), '', slip.gross, 'total'),
            line(t('pf'), '', -slip.deductionItems[0].amount),
            line(t('esi'), '', -slip.deductionItems[1].amount),
            line(t('net'), '', slip.net, 'total')))),
        h('p', { class: 'muted small', text: t('pay_note', { m: slip.otMultiplier }) })),
      slip.days.length === 0 ? null : h('div', { class: 'card' },
        h('details', {},
          h('summary', { text: t('daily_breakdown') }),
          h('div', { class: 'table-wrap' }, h('table', {},
            h('thead', {}, h('tr', {}, h('th', { text: t('date') }), h('th', { class: 'num', text: t('hours') }), h('th', { class: 'num', text: t('overtime') }))),
            h('tbody', {}, slip.days.map((d) => h('tr', {}, h('td', { text: FS.date(d.date + 'T12:00:00+05:30') }), h('td', { class: 'num', text: FS.hrs(d.total) }), h('td', { class: 'num', text: FS.hrs(d.overtime) })))))))),
    );
  }

  // ---- Tab: Safety reporting (type or speak) -------------------------------
  async function renderSafety() {
    const categories = ['fall', 'electrical', 'fire', 'machinery', 'chemical', 'slip', 'equipment', 'other'];
    const textarea = h('textarea', { id: 'desc', maxlength: 500, required: true });
    const anon = h('input', { id: 'anon', type: 'checkbox', checked: true, style: 'width:auto;min-height:auto;margin-right:.5rem' });
    const result = h('div', { 'aria-live': 'polite' });
    let stop = null;

    const speakBtn = h('button', { type: 'button', class: 'secondary', onclick: () => {
      if (!FS.canListen) return FS.toast(t('voice_unsupported'), 'error');
      if (stop) { stop(); return; }
      speakBtn.textContent = '🎙️ ' + t('stop_listening');
      stop = FS.listen({
        onText: (text) => { textarea.value = (textarea.value + ' ' + text).trim(); },
        onEnd: () => { stop = null; speakBtn.textContent = '🎙️ ' + t('speak'); },
      });
    } }, '🎙️ ', t('speak'));

    const form = h('form', { class: 'card', onsubmit: async (e) => {
      e.preventDefault();
      const data = new FormData(form);
      const out = await guarded(() => FS.api('POST', '/api/worker/reports', {
        category: data.get('category'), severity: data.get('severity'), description: textarea.value, anonymous: anon.checked,
      }));
      if (!out) return;
      form.reset(); anon.checked = true;
      result.replaceChildren(h('div', { class: 'card' },
        h('p', { text: '✅ ' + t('report_sent') }),
        h('div', { class: 'code-box', text: out.code }), ' ',
        h('button', { type: 'button', class: 'secondary small', onclick: () => navigator.clipboard?.writeText(out.code).then(() => FS.toast(t('copied'))) }, t('copy'))));
    } },
      h('h1', { text: '🦺 ' + t('safety_title') }),
      h('fieldset', { class: 'choices' }, h('legend', { text: t('what_kind') }),
        categories.map((c) => choice('category', c, CATEGORY_ICONS[c], t('cat_' + c)))),
      h('fieldset', { class: 'choices' }, h('legend', { text: t('how_serious') }),
        ['low', 'medium', 'high'].map((s) => choice('severity', s, SEVERITY_ICONS[s], t('sev_' + s)))),
      h('div', { class: 'field' }, h('label', { for: 'desc', text: t('describe') }), textarea, h('div', { style: 'margin-top:.5rem' }, speakBtn)),
      h('div', { class: 'field' }, h('label', { for: 'anon', style: 'display:flex;align-items:center;font-weight:600' }, anon, t('stay_anon'))),
      h('button', { class: 'big', type: 'submit' }, '📨 ', t('submit')));

    const mine = await FS.api('GET', '/api/worker/reports');
    view.replaceChildren(form, result, mine.length ? h('div', { class: 'card' },
      mine.map((r) => h('p', {}, h('strong', { text: r.code }), ' · ' + t('cat_' + r.category) + ' · ', h('span', { class: 'badge info', text: t('status_' + r.status) })))) : null);
  }

  // ---- Tab: Anonymous feedback ----------------------------------------------
  function renderFeedback() {
    const rating = (name, label) => h('fieldset', { class: 'choices', style: 'grid-template-columns:repeat(5,1fr)' },
      h('legend', { text: label }),
      [1, 2, 3, 4, 5].map((n) => h('label', { class: 'choice' },
        h('input', { type: 'radio', name, value: n, required: true, 'aria-label': t('stars', { n }) }),
        h('span', {}, h('span', { class: 'ico', 'aria-hidden': 'true', text: '★' }), h('span', { text: String(n) })))));

    const comment = h('textarea', { id: 'comment', maxlength: 280 });
    const form = h('form', { class: 'card', onsubmit: async (e) => {
      e.preventDefault();
      const d = new FormData(form);
      const ok = await guarded(() => FS.api('POST', '/api/worker/feedback', {
        manager: Number(d.get('manager')), conditions: Number(d.get('conditions')), safety: Number(d.get('safety')), comment: comment.value,
      }));
      if (ok) { form.reset(); FS.toast(t('fb_sent')); }
    } },
      h('h1', { text: '💬 ' + t('fb_title') }),
      h('p', { class: 'alert ok', text: '🔒 ' + t('fb_intro') }),
      rating('manager', t('rate_manager')), rating('conditions', t('rate_conditions')), rating('safety', t('rate_safety')),
      h('div', { class: 'field' }, h('label', { for: 'comment', text: t('comment_optional') }), comment),
      h('button', { class: 'big', type: 'submit' }, '📨 ', t('submit')));
    view.replaceChildren(form);
  }

  // ---- Tab: Skill passport -----------------------------------------------------
  async function renderPassport() {
    const data = await FS.api('GET', '/api/worker/passport');
    const link = data.shareToken ? `${location.origin}/passport.html?t=${data.shareToken}` : null;

    const list = data.credentials.length
      ? data.credentials.map((c) => h('div', { class: 'card', style: 'margin-bottom:.6rem' },
          h('strong', { text: c.title }), h('div', { class: 'muted small', text: `${c.issuer} · ${c.issuedOn}${c.expiresOn ? ' · ' + t('expires', { d: c.expiresOn }) : ''}` }),
          h('span', { class: `badge ${c.verified ? 'ok' : 'warning'}`, text: (c.verified ? '✔ ' + t('verified') : t('self_declared')) })))
      : [h('p', { class: 'muted', text: t('pp_empty') })];

    const title = h('input', { id: 'sk-title', required: true, maxlength: 80 });
    const issuer = h('input', { id: 'sk-issuer', maxlength: 80 });
    const date = h('input', { id: 'sk-date', type: 'date', required: true });
    const form = h('form', { class: 'card', onsubmit: async (e) => {
      e.preventDefault();
      const ok = await guarded(() => FS.api('POST', '/api/worker/passport', { title: title.value, issuer: issuer.value, issuedOn: date.value }));
      if (ok) renderPassport();
    } },
      h('h2', { text: t('add_skill') }),
      h('div', { class: 'field' }, h('label', { for: 'sk-title', text: t('skill_name') }), title),
      h('div', { class: 'field' }, h('label', { for: 'sk-issuer', text: t('issuer') }), issuer),
      h('div', { class: 'field' }, h('label', { for: 'sk-date', text: t('date_obtained') }), date),
      h('button', { type: 'submit' }, '➕ ', t('save')));

    const share = h('div', { class: 'card' },
      link
        ? [h('p', { text: t('share_link') }), h('input', { readonly: true, value: link, 'aria-label': t('share_link'), onfocus: (e) => e.target.select() }),
           h('div', { class: 'row', style: 'margin-top:.6rem' },
             h('button', { class: 'secondary', type: 'button', onclick: () => navigator.clipboard?.writeText(link).then(() => FS.toast(t('copied'))) }, t('copy')),
             h('button', { class: 'secondary', type: 'button', onclick: async () => { await guarded(() => FS.api('DELETE', '/api/worker/passport/share')); renderPassport(); } }, t('stop_sharing')))]
        : h('button', { type: 'button', onclick: async () => { await guarded(() => FS.api('POST', '/api/worker/passport/share')); renderPassport(); } }, '🔗 ', t('share_passport')));

    view.replaceChildren(h('div', {}, h('h1', { text: '🎓 ' + t('pp_title') }), list), share, form);
  }

  // ---- Tabs wiring (arrow-key navigation per the ARIA tabs pattern) --------
  const renderers = { shift: renderShift, pay: () => renderPay(), safety: renderSafety, feedback: renderFeedback, passport: renderPassport };

  async function show(name) {
    current = name;
    tabs.forEach((tab) => {
      const selected = tab.dataset.tab === name;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    view.replaceChildren(h('p', { class: 'muted', text: t('loading') }));
    try { await renderers[name](); } catch (e) { view.replaceChildren(h('p', { class: 'alert critical', text: FS.errText(e) })); }
    window.scrollTo(0, 0);
  }

  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => show(tab.dataset.tab));
    tab.addEventListener('keydown', (e) => {
      const move = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (!move) return;
      const next = tabs[(i + move + tabs.length) % tabs.length];
      next.focus(); show(next.dataset.tab);
    });
  });

  document.getElementById('logout').addEventListener('click', FS.logout);

  (async function init() {
    me = await FS.api('GET', '/api/worker/me');
    if (!FS.hasSavedLang && me.lang !== FS.lang) FS.lang = me.lang;
    FS.langPicker(document.getElementById('lang'), (lang) => {
      FS.api('POST', '/api/worker/language', { lang }).catch(() => {});
      show(current);
    });
    document.getElementById('lang').value = FS.lang;
    document.getElementById('who').textContent = `${me.name} · ${me.id}`;
    FS.applyI18n();
    show('shift');
  })();
})();
