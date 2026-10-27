/* Shared helpers: i18n, API client, safe DOM builder, voice input/output, toasts. */
(function () {
  'use strict';

  const I = window.FS_I18N;
  const safe = {
    get(store, key) { try { return window[store].getItem(key); } catch { return null; } },
    set(store, key, val) { try { window[store].setItem(key, val); } catch { /* storage may be blocked */ } },
    del(store, key) { try { window[store].removeItem(key); } catch { /* ignore */ } },
  };

  const FS = { lang: safe.get('localStorage', 'fs_lang') || 'en', hasSavedLang: Boolean(safe.get('localStorage', 'fs_lang')) };
  if (!I.dict[FS.lang]) FS.lang = 'en';

  /** Translate a key, with {placeholder} substitution; falls back to English, then the key. */
  FS.t = (key, vars) => {
    const raw = (I.dict[FS.lang] && I.dict[FS.lang][key]) || I.dict.en[key] || key;
    return vars ? raw.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : '')) : raw;
  };

  /** Safe DOM builder: text is always set via textContent, never innerHTML. */
  FS.h = (tag, props, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'style') el.style.cssText = v; // CSSOM is allowed by the strict CSP; style attributes are not
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
    return el;
  };

  FS.applyI18n = (root = document) => {
    document.documentElement.lang = FS.lang;
    root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = FS.t(el.dataset.i18n); });
    root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.placeholder = FS.t(el.dataset.i18nPlaceholder); });
    root.querySelectorAll('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', FS.t(el.dataset.i18nAria)); });
  };

  /** Fill a <select> with the language list and call onChange after switching. */
  FS.langPicker = (select, onChange) => {
    select.replaceChildren(...Object.entries(I.names).map(([code, name]) => FS.h('option', { value: code, text: name, selected: code === FS.lang })));
    select.addEventListener('change', () => {
      FS.lang = select.value;
      safe.set('localStorage', 'fs_lang', FS.lang);
      FS.hasSavedLang = true;
      FS.applyI18n();
      if (onChange) onChange(FS.lang);
    });
  };

  // ---- Session & API ------------------------------------------------------
  FS.session = {
    get token() { return safe.get('sessionStorage', 'fs_token'); },
    get role() { return safe.get('sessionStorage', 'fs_role'); },
    save(token, role) { safe.set('sessionStorage', 'fs_token', token); safe.set('sessionStorage', 'fs_role', role); },
    clear() { safe.del('sessionStorage', 'fs_token'); safe.del('sessionStorage', 'fs_role'); },
  };

  FS.api = async (method, path, body) => {
    const headers = { 'Content-Type': 'application/json' };
    if (FS.session.token) headers.Authorization = `Bearer ${FS.session.token}`;
    let res;
    try {
      res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    } catch {
      throw Object.assign(new Error('network'), { code: 'network' });
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && FS.session.token) {
      FS.session.clear();
      window.location.href = '/';
    }
    if (!res.ok) throw Object.assign(new Error(data.error || 'error'), { code: data.error || 'error', status: res.status });
    return data;
  };

  const ERROR_KEYS = {
    wrong_site: 'err_wrong_site', already_checked_in: 'err_already', not_checked_in: 'err_not_in',
    unknown_site_code: 'err_unknown_code', invalid_report: 'err_invalid_report', already_submitted: 'err_already_submitted',
    invalid_credentials: 'err_login', not_found: 'err_not_found',
  };
  FS.errText = (err) => FS.t(ERROR_KEYS[err && err.code] || 'err_generic');

  // ---- Toasts (announced to screen readers via role=status) ---------------
  let toastTimer;
  FS.toast = (message, kind) => {
    let el = document.getElementById('toast');
    if (!el) {
      el = FS.h('div', { id: 'toast', role: 'status', 'aria-live': 'polite', hidden: true });
      document.body.append(el);
    }
    el.className = kind === 'error' ? 'error' : '';
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 5000);
  };

  // ---- Voice: text-to-speech and speech-to-text (progressive enhancement) --
  FS.canSpeak = 'speechSynthesis' in window;
  FS.speak = (text) => {
    if (!FS.canSpeak) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = I.speech[FS.lang];
    u.rate = 0.9;
    window.speechSynthesis.speak(u);
  };

  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  FS.canListen = Boolean(Recognition);
  /** Start dictation; returns a stop() function. */
  FS.listen = ({ onText, onEnd }) => {
    const rec = new Recognition();
    rec.lang = I.speech[FS.lang];
    rec.interimResults = false;
    rec.onresult = (e) => onText(Array.from(e.results, (r) => r[0].transcript).join(' '));
    rec.onend = onEnd;
    rec.onerror = onEnd;
    rec.start();
    return () => rec.stop();
  };

  // ---- Formatting ---------------------------------------------------------
  const LOCALES = { en: 'en-IN', ta: 'ta-IN', hi: 'hi-IN', te: 'te-IN' };
  FS.money = (n) => {
    const v = Number(n);
    const text = '₹' + Math.abs(v).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    return v < 0 ? '−' + text : text;
  };
  FS.date = (iso) => new Date(iso).toLocaleDateString(LOCALES[FS.lang], { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
  FS.dateTime = (iso) => new Date(iso).toLocaleString(LOCALES[FS.lang], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  FS.hrs = (n) => Math.round(n * 10) / 10;

  FS.logout = () => { FS.session.clear(); window.location.href = '/'; };

  window.FS = FS;
})();
