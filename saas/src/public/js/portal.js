/**
 * Chat Pilot portal client script.
 *
 * Vanilla JS, no build step. Mirrors the interaction model of the plugin's
 * admin-script.js: AJAX save/test buttons, a toast, and per-screen handlers
 * bound by data attributes.
 */
(function () {
  'use strict';

  var csrf = document.querySelector('meta[name="cp-csrf"]');
  var CSRF = csrf ? csrf.getAttribute('content') : '';
  var root = document.querySelector('[data-website-id]');
  var WEBSITE_ID = root ? root.getAttribute('data-website-id') : '';
  var API = '/api/v1/portal';

  /* ------------------------------------------------------------ toast -- */

  var toastEl = document.getElementById('cp-toast');
  var toastTimer = null;

  function toast(message, type) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.className = 'cp-alert cp-toast cp-alert-' + (type || 'success');
    toastEl.style.display = 'flex';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.style.display = 'none';
    }, 5000);
  }
  window.cpToast = toast;

  /* -------------------------------------------------------------- api -- */

  function request(method, path, body) {
    return fetch(API + path, {
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': CSRF,
        'X-Requested-With': 'XMLHttpRequest',
      },
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then(function (res) {
      return res.json().then(function (payload) {
        if (!res.ok || payload.ok === false) {
          var err = new Error((payload.error && payload.error.message) || 'Request failed.');
          err.fields = (payload.error && payload.error.fields) || {};
          err.code = payload.error && payload.error.code;
          throw err;
        }
        return payload.data;
      });
    });
  }
  window.cpApi = {
    get: function (p) { return request('GET', p); },
    post: function (p, b) { return request('POST', p, b || {}); },
    site: function (p) { return '/websites/' + WEBSITE_ID + p; },
    websiteId: WEBSITE_ID,
  };

  function busy(button, isBusy, busyLabel) {
    if (!button) return;
    if (isBusy) {
      button.dataset.originalLabel = button.textContent;
      button.textContent = busyLabel || 'Working…';
      button.disabled = true;
    } else {
      if (button.dataset.originalLabel) button.textContent = button.dataset.originalLabel;
      button.disabled = false;
    }
  }
  window.cpBusy = busy;

  function serialise(form) {
    var data = {};
    Array.prototype.forEach.call(form.elements, function (el) {
      if (!el.name || el.name === '_csrf' || el.disabled) return;
      if (el.type === 'checkbox') data[el.name] = el.checked;
      else if (el.type === 'radio') { if (el.checked) data[el.name] = el.value; }
      else data[el.name] = el.value;
    });
    return data;
  }
  window.cpSerialise = serialise;

  function showFieldErrors(form, fields) {
    form.querySelectorAll('.cp-field-error').forEach(function (n) { n.remove(); });
    form.querySelectorAll('.has-error').forEach(function (n) { n.classList.remove('has-error'); });
    Object.keys(fields || {}).forEach(function (name) {
      var input = form.querySelector('[name="' + name + '"]');
      if (!input) return;
      input.classList.add('has-error');
      var note = document.createElement('div');
      note.className = 'cp-field-error';
      note.textContent = fields[name];
      input.parentNode.appendChild(note);
    });
  }
  window.cpFieldErrors = showFieldErrors;

  /* ------------------------------------------------- website switcher -- */

  var switcher = document.querySelector('[data-website-switcher]');
  if (switcher) {
    switcher.addEventListener('change', function () {
      var path = window.location.pathname.replace(
        /\/app\/websites\/[^/]+/,
        '/app/websites/' + switcher.value,
      );
      window.location.href = path;
    });
  }

  /* --------------------------------------------- generic ajax forms -- */

  document.querySelectorAll('form[data-ajax]').forEach(function (form) {
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var endpoint = form.getAttribute('data-ajax');
      var button = form.querySelector('[type="submit"]');
      busy(button, true, form.getAttribute('data-busy-label') || 'Saving…');

      request('POST', window.cpApi.site(endpoint), serialise(form))
        .then(function () {
          toast(form.getAttribute('data-success') || 'Saved.', 'success');
          showFieldErrors(form, {});
          if (form.hasAttribute('data-reload')) {
            setTimeout(function () { window.location.reload(); }, 600);
          }
        })
        .catch(function (err) {
          toast(err.message, 'error');
          showFieldErrors(form, err.fields);
        })
        .finally(function () { busy(button, false); });
    });
  });

  /* ----------------------------------------- generic confirm actions -- */

  document.querySelectorAll('[data-post]').forEach(function (el) {
    el.addEventListener('click', function (event) {
      event.preventDefault();
      var confirmText = el.getAttribute('data-confirm');
      if (confirmText && !window.confirm(confirmText)) return;
      busy(el, true, 'Working…');
      var payload = {};
      if (el.getAttribute('data-body')) {
        try { payload = JSON.parse(el.getAttribute('data-body')); } catch (e) { payload = {}; }
      }
      request('POST', window.cpApi.site(el.getAttribute('data-post')), payload)
        .then(function () {
          toast(el.getAttribute('data-success') || 'Done.', 'success');
          setTimeout(function () { window.location.reload(); }, 500);
        })
        .catch(function (err) {
          toast(err.message, 'error');
          busy(el, false);
        });
    });
  });

  /* -------------------------------------------------------- theme -- */

  /*
   * Day/night. The saved choice is applied before first paint by the inline
   * script in the head partial; this only handles switching and keeping the
   * buttons in sync. Light is the default, so an unset preference shows the
   * day button as the active one.
   */
  (function themeSwitch() {
    var buttons = document.querySelectorAll('[data-theme-set]');
    if (!buttons.length) return;

    function current() {
      // Light is the product default; only an explicit choice makes it dark.
      return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    }

    function sync() {
      var active = current();
      buttons.forEach(function (button) {
        button.setAttribute('aria-pressed', button.getAttribute('data-theme-set') === active ? 'true' : 'false');
      });
    }

    buttons.forEach(function (button) {
      button.addEventListener('click', function () {
        var choice = button.getAttribute('data-theme-set');
        document.documentElement.setAttribute('data-theme', choice);
        try { localStorage.setItem('cp-theme', choice); } catch (e) { /* storage blocked */ }
        sync();
      });
    });

    sync();
  })();

  /* --------------------------------------------------- reveal a secret -- */

  /*
   * The eye button on every key field. Kept here rather than per screen so a
   * password input anywhere in the portal gets the same control, and so the
   * field always starts masked no matter how the page was reached.
   */
  (function revealSecrets() {
    document.querySelectorAll('[data-reveal]').forEach(function (button) {
      var input = document.getElementById(button.getAttribute('data-reveal'));
      if (!input) return;
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', function () {
        var shown = input.type === 'text';
        input.type = shown ? 'password' : 'text';
        button.setAttribute('aria-pressed', shown ? 'false' : 'true');
        button.setAttribute('aria-label', shown ? 'Show key' : 'Hide key');
        input.focus();
      });
    });
  })();

  /* --------------------------------------------------- copy to clipboard -- */

  document.querySelectorAll('[data-copy]').forEach(function (el) {
    el.addEventListener('click', function () {
      var target = document.querySelector(el.getAttribute('data-copy'));
      if (!target) return;
      var value = target.textContent.trim();
      if (navigator.clipboard) {
        navigator.clipboard.writeText(value).then(function () { toast('Copied to clipboard.', 'success'); });
      } else {
        var area = document.createElement('textarea');
        area.value = value;
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy');
        document.body.removeChild(area);
        toast('Copied to clipboard.', 'success');
      }
    });
  });
})();
