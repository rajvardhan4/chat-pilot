/** AI Providers screen: save key, test connection, discover models, select model. */
(function () {
  'use strict';
  var api = window.cpApi;
  if (!api) return;

  function card(provider) {
    return document.querySelector('[data-provider-card="' + provider + '"]');
  }

  /* ------------------------------------------------------------ picker -- */

  /*
   * One dropdown drives the page. Every provider's panel is rendered by the
   * server and hidden; choosing from the dropdown reveals one. Rendering them
   * all server-side keeps EJS escaping in charge of the provider metadata -
   * nothing about a provider is assembled in the browser.
   */
  var picker = document.querySelector('[data-provider-picker]');

  function show(provider) {
    document.querySelectorAll('[data-provider-card]').forEach(function (panel) {
      panel.hidden = panel.getAttribute('data-provider-card') !== provider;
    });
  }

  if (picker) {
    picker.addEventListener('change', function () { show(picker.value); });
  }

  // "Manage" in the saved-keys table jumps the dropdown to that provider.
  document.querySelectorAll('[data-jump-provider]').forEach(function (button) {
    button.addEventListener('click', function () {
      var provider = button.getAttribute('data-jump-provider');
      if (picker) picker.value = provider;
      show(provider);
      var panel = card(provider);
      if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  /* Keeps the dropdown's status suffix honest after a test. */
  function setPickerLabel(provider, statusLabel) {
    if (!picker) return;
    Array.prototype.forEach.call(picker.options, function (option) {
      if (option.value !== provider) return;
      option.textContent = option.textContent.split(' — ')[0].trim() +
        (statusLabel && statusLabel !== 'Not Configured' ? ' — ' + statusLabel : '');
    });
  }

  function setStatus(provider, label, tone) {
    var el = card(provider) && card(provider).querySelector('[data-provider-status]');
    if (!el) return;
    el.textContent = label;
    el.className = 'cp-pill ' + (tone || '');
    setPickerLabel(provider, label);
  }

  document.querySelectorAll('[data-provider-form]').forEach(function (form) {
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var provider = form.getAttribute('data-provider-form');
      var data = window.cpSerialise(form);
      if (!data.api_key) {
        window.cpToast('Enter an API key before saving.', 'error');
        return;
      }
      var button = form.querySelector('[type="submit"]');
      window.cpBusy(button, true, 'Saving…');
      api.post(api.site('/providers/credentials'), data)
        .then(function () {
          window.cpToast('API key saved securely. Now run a connection test.', 'success');
          setStatus(provider, 'Not Configured', '');
          var testBtn = document.querySelector('[data-test-provider="' + provider + '"]');
          if (testBtn) testBtn.disabled = false;
          form.querySelector('[name="api_key"]').value = '';
        })
        .catch(function (err) {
          window.cpToast(err.message, 'error');
          window.cpFieldErrors(form, err.fields);
        })
        .finally(function () { window.cpBusy(button, false); });
    });
  });

  document.querySelectorAll('[data-test-provider]').forEach(function (button) {
    button.addEventListener('click', function () {
      var provider = button.getAttribute('data-test-provider');
      window.cpBusy(button, true, 'Testing…');
      api.post(api.site('/providers/test'), { provider: provider })
        .then(function (data) {
          var match = data.providers.filter(function (p) { return p.provider === provider; })[0];
          setStatus(provider, match ? match.statusLabel : 'Unknown',
            data.ok ? 'cp-pill-success' : 'cp-pill-error');

          var detail = card(provider).querySelector('[data-provider-detail]');
          if (detail) detail.textContent = data.message;

          if (data.ok) {
            var select = document.querySelector('[data-model-select="' + provider + '"]');
            var manual = document.querySelector('[data-model-manual="' + provider + '"]');

            if (select) {
              select.innerHTML = '';
              data.models.forEach(function (m) {
                var option = document.createElement('option');
                option.value = m.id;
                option.textContent = m.displayName;
                if (m.id === data.suggestedModel) option.selected = true;
                select.appendChild(option);
              });
              // Show the dropdown when the provider lists models, and fall back
              // to a free-text field when it does not.
              select.style.display = data.models.length ? '' : 'none';
            }
            if (manual) {
              manual.style.display = data.models.length ? 'none' : '';
              manual.placeholder = 'Enter a model id';
            }

            // The connection passed, so selection is now allowed either way.
            var selectBtn = document.querySelector('[data-select-provider="' + provider + '"]');
            if (selectBtn) selectBtn.disabled = false;
            window.cpToast(
              'Connected in ' + data.latencyMs + 'ms. Discovered ' + data.models.length + ' usable model(s).',
              'success',
            );
          } else {
            window.cpToast(data.message, 'error');
          }
        })
        .catch(function (err) { window.cpToast(err.message, 'error'); })
        .finally(function () { window.cpBusy(button, false); });
    });
  });

  document.querySelectorAll('[data-select-provider]').forEach(function (button) {
    button.addEventListener('click', function () {
      var provider = button.getAttribute('data-select-provider');
      var select = document.querySelector('[data-model-select="' + provider + '"]');
      var manual = document.querySelector('[data-model-manual="' + provider + '"]');
      // Whichever control is visible is the one the customer used.
      var chosen = select && select.options.length && select.style.display !== 'none'
        ? select.value
        : (manual ? manual.value.trim() : '');

      window.cpBusy(button, true, 'Saving…');
      api.post(api.site('/providers/select'), { provider: provider, model: chosen })
        .then(function (data) {
          window.cpToast('Now using ' + data.config.active_provider + ' / ' + data.config.active_model + '.', 'success');
          setTimeout(function () { window.location.reload(); }, 700);
        })
        .catch(function (err) {
          window.cpToast(err.message, 'error');
          window.cpBusy(button, false);
        });
    });
  });

  document.querySelectorAll('[data-remove-provider]').forEach(function (button) {
    button.addEventListener('click', function () {
      var provider = button.getAttribute('data-remove-provider');
      if (!window.confirm('Remove the stored ' + provider + ' credentials for this website?')) return;
      window.cpBusy(button, true, 'Removing…');
      api.post(api.site('/providers/remove'), { provider: provider })
        .then(function () {
          window.cpToast('Credentials removed.', 'success');
          setTimeout(function () { window.location.reload(); }, 600);
        })
        .catch(function (err) {
          window.cpToast(err.message, 'error');
          window.cpBusy(button, false);
        });
    });
  });
})();
