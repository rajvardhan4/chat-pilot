/** Forms screen: field builder + activation. */
(function () {
  'use strict';
  var api = window.cpApi;
  if (!api) return;

  var TYPES = ['text', 'email', 'phone', 'textarea', 'dropdown', 'checkbox', 'radio'];

  var dataEl = document.getElementById('cp-forms-data');
  var forms = [];
  try {
    forms = JSON.parse(dataEl ? dataEl.textContent : '[]');
  } catch (err) {
    forms = [];
  }

  var rows = document.getElementById('cp-field-rows');
  var nameInput = document.getElementById('cp-form-name');
  var idInput = document.getElementById('cp-form-id');
  if (!rows || !nameInput || !idInput) return;

  function addRow(field) {
    var f = field || { field_key: '', type: 'text', label: '', placeholder: '', options: '', required: false, enabled: true };
    var wrap = document.createElement('div');
    wrap.className = 'cp-card';
    wrap.style.marginBottom = '0.75rem';
    wrap.style.padding = '1rem';
    wrap.setAttribute('data-field-row', '1');

    var typeOptions = TYPES.map(function (t) {
      return '<option value="' + t + '"' + (f.type === t ? ' selected' : '') + '>' + t + '</option>';
    }).join('');

    wrap.innerHTML =
      '<div class="cp-grid cp-grid-3">' +
      '<div class="cp-form-group"><label class="cp-label">Label</label>' +
      '<input class="cp-input" data-f="label" value="' + escapeAttr(f.label) + '"></div>' +
      '<div class="cp-form-group"><label class="cp-label">Key</label>' +
      '<input class="cp-input" data-f="field_key" value="' + escapeAttr(f.field_key) + '" placeholder="auto"></div>' +
      '<div class="cp-form-group"><label class="cp-label">Type</label>' +
      '<select class="cp-select" data-f="type">' + typeOptions + '</select></div>' +
      '<div class="cp-form-group"><label class="cp-label">Placeholder</label>' +
      '<input class="cp-input" data-f="placeholder" value="' + escapeAttr(f.placeholder) + '"></div>' +
      '<div class="cp-form-group"><label class="cp-label">Options (one per line)</label>' +
      '<textarea class="cp-input" data-f="options" rows="2">' + escapeHtml(f.options) + '</textarea></div>' +
      '<div class="cp-form-group"><label class="cp-label">Rules</label>' +
      '<label class="cp-checkbox-label"><input type="checkbox" data-f="required"' + (f.required ? ' checked' : '') + '> Required</label>' +
      '<label class="cp-checkbox-label"><input type="checkbox" data-f="enabled"' + (f.enabled ? ' checked' : '') + '> Enabled</label>' +
      '<button class="cp-btn cp-btn-danger cp-btn-sm" type="button" data-remove-row>Remove field</button>' +
      '</div></div>';

    wrap.querySelector('[data-remove-row]').addEventListener('click', function () { wrap.remove(); });
    rows.appendChild(wrap);
  }

  function collect() {
    return Array.prototype.map.call(rows.querySelectorAll('[data-field-row]'), function (row) {
      function val(name) {
        var el = row.querySelector('[data-f="' + name + '"]');
        if (!el) return '';
        return el.type === 'checkbox' ? el.checked : el.value;
      }
      return {
        field_key: String(val('field_key') || '').trim(),
        type: val('type'),
        label: val('label'),
        placeholder: val('placeholder'),
        options: val('options'),
        required: Boolean(val('required')),
        enabled: Boolean(val('enabled')),
      };
    });
  }

  document.getElementById('cp-add-field').addEventListener('click', function () { addRow(null); });

  document.getElementById('cp-reset-builder').addEventListener('click', function () {
    rows.innerHTML = '';
    nameInput.value = '';
    idInput.value = '';
    addRow(null);
  });

  document.getElementById('cp-save-form').addEventListener('click', function () {
    var button = this;
    var fields = collect();
    if (!nameInput.value.trim()) {
      window.cpToast('Give the form a name.', 'error');
      return;
    }
    if (!fields.length) {
      window.cpToast('Add at least one field.', 'error');
      return;
    }
    window.cpBusy(button, true, 'Saving…');
    api.post(api.site('/forms'), {
      form_id: idInput.value || undefined,
      name: nameInput.value.trim(),
      status: 'active',
      fields: fields,
    })
      .then(function () {
        window.cpToast('Form saved.', 'success');
        setTimeout(function () { window.location.reload(); }, 700);
      })
      .catch(function (err) {
        window.cpToast(err.message, 'error');
        window.cpBusy(button, false);
      });
  });

  document.querySelectorAll('[data-edit-form]').forEach(function (button) {
    button.addEventListener('click', function () {
      var id = button.getAttribute('data-edit-form');
      var form = forms.filter(function (f) { return f.id === id; })[0];
      if (!form) return;
      rows.innerHTML = '';
      nameInput.value = form.name;
      idInput.value = form.id;
      form.fields.forEach(function (f) {
        addRow({
          field_key: f.field_key, type: f.type, label: f.label,
          placeholder: f.placeholder, options: f.options,
          required: Boolean(f.required), enabled: Boolean(f.enabled),
        });
      });
      document.getElementById('cp-field-rows').scrollIntoView({ behavior: 'smooth' });
    });
  });

  document.querySelectorAll('[data-activate-form]').forEach(function (button) {
    button.addEventListener('click', function () {
      window.cpBusy(button, true, '…');
      api.post(api.site('/forms/active'), { form_id: button.getAttribute('data-activate-form') })
        .then(function () {
          window.cpToast('Widget now uses this form.', 'success');
          setTimeout(function () { window.location.reload(); }, 600);
        })
        .catch(function (err) {
          window.cpToast(err.message, 'error');
          window.cpBusy(button, false);
        });
    });
  });

  if (!rows.children.length) addRow(null);

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escapeAttr(value) {
    return escapeHtml(value).replace(/"/g, '&quot;');
  }
})();
