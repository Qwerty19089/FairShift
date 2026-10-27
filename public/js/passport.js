(function () {
  'use strict';
  const { FS } = window;
  const { h, t } = FS;

  const token = new URLSearchParams(window.location.search).get('t') || '';
  const box = document.getElementById('passport');
  document.getElementById('print').addEventListener('click', () => window.print());

  FS.api('GET', `/api/passport/${encodeURIComponent(token)}`)
    .then((p) => {
      box.replaceChildren(
        h('h1', { text: '🎓 ' + p.name }),
        h('p', { class: 'muted', text: `${p.role} · ${t('sector_' + p.sector)}` }),
        ...p.credentials.map((c) => h('div', { style: 'padding:.5rem 0;border-top:1px solid var(--line)' },
          h('strong', { text: c.title }),
          h('div', { class: 'muted small', text: `${c.issuer} · ${c.issuedOn}${c.expiresOn ? ' · ' + t('expires', { d: c.expiresOn }) : ''}` }),
          h('span', { class: `badge ${c.verified ? 'ok' : 'warning'}`, text: c.verified ? '✔ ' + t('verified') : t('self_declared') }))));
    })
    .catch(() => box.replaceChildren(h('p', { class: 'alert critical', text: t('err_not_found') })));
})();
