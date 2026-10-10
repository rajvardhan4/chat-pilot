/** Chat Widget screen: live preview of the payload the plugin will receive. */
(function () {
  'use strict';
  var api = window.cpApi;
  var target = document.getElementById('cp-widget-preview');

  function refresh() {
    if (!api || !target) return;
    api.get(api.site('/widget/preview'))
      .then(function (data) {
        target.textContent = JSON.stringify(data.preview, null, 2);
      })
      .catch(function (err) {
        target.textContent = err.message;
      });
  }

  refresh();

  var form = document.querySelector('form[data-ajax="/widget"]');

  // --- Helper: sanitize and normalize hex color to 6-digit #RRGGBB ---
  function sanitizeHex(val) {
    if (!val) return null;
    var clean = String(val).trim().replace(/^#/, '');
    if (/^[0-9a-fA-F]{3}$/.test(clean)) {
      return '#' + clean[0] + clean[0] + clean[1] + clean[1] + clean[2] + clean[2];
    }
    if (/^[0-9a-fA-F]{6}$/.test(clean)) {
      return '#' + clean;
    }
    return null;
  }

  // --- Two-Way Color Syncing (Picker <-> Text Input) ---
  function bindColorPicker(pickerId, textId, fallbackHex) {
    var picker = document.getElementById(pickerId);
    var text = document.getElementById(textId);
    if (!picker || !text) return;

    // 1. Color Picker -> Text field
    function syncFromPicker() {
      if (picker.value) {
        text.value = picker.value.toUpperCase();
      }
    }
    picker.addEventListener('input', syncFromPicker);
    picker.addEventListener('change', syncFromPicker);

    // 2. Text field -> Color Picker (as user types or pastes)
    text.addEventListener('input', function () {
      var full = sanitizeHex(text.value);
      if (full) {
        picker.value = full.toLowerCase();
      }
    });

    // 3. Format and validate on blur
    text.addEventListener('blur', function () {
      var full = sanitizeHex(text.value);
      if (full) {
        text.value = full.toUpperCase();
        picker.value = full.toLowerCase();
      } else {
        // Revert to current picker or fallback if invalid
        text.value = (picker.value || fallbackHex).toUpperCase();
      }
    });

    // 4. Auto-select text on focus for effortless replacement
    text.addEventListener('focus', function () {
      text.select();
    });
  }

  bindColorPicker('primary_color', 'primary_color_text', '#0678f9');
  bindColorPicker('icon_color', 'icon_color_text', '#ffffff');
  bindColorPicker('launcher_callout_bg', 'launcher_callout_bg_text', '#16213a');
  bindColorPicker('launcher_callout_color', 'launcher_callout_color_text', '#ffffff');

  // Form submit synchronization
  if (form) {
    // Capturing phase ensures picker values are perfectly normalized before form serialisation
    form.addEventListener('submit', function () {
      var pPicker = document.getElementById('primary_color');
      var pText = document.getElementById('primary_color_text');
      if (pPicker && pText) {
        var p = sanitizeHex(pText.value);
        if (p) {
          pPicker.value = p.toLowerCase();
          pText.value = p.toUpperCase();
        }
      }

      var iPicker = document.getElementById('icon_color');
      var iText = document.getElementById('icon_color_text');
      if (iPicker && iText) {
        var i = sanitizeHex(iText.value);
        if (i) {
          iPicker.value = i.toLowerCase();
          iText.value = i.toUpperCase();
        }
      }

      var bgPicker = document.getElementById('launcher_callout_bg');
      var bgText = document.getElementById('launcher_callout_bg_text');
      if (bgPicker && bgText) {
        var bg = sanitizeHex(bgText.value);
        if (bg) {
          bgPicker.value = bg.toLowerCase();
          bgText.value = bg.toUpperCase();
        }
      }

      var cPicker = document.getElementById('launcher_callout_color');
      var cText = document.getElementById('launcher_callout_color_text');
      if (cPicker && cText) {
        var c = sanitizeHex(cText.value);
        if (c) {
          cPicker.value = c.toLowerCase();
          cText.value = c.toUpperCase();
        }
      }

      setTimeout(refresh, 800);
    }, true);
  }

  // --- Avatar Selector Handling ---
  var avatarInput = document.getElementById('avatar_type');
  var customLogoContainer = document.getElementById('cp-custom-logo-container');
  var avatarCards = document.querySelectorAll('.cp-avatar-card');

  avatarCards.forEach(function (card) {
    card.addEventListener('click', function () {
      var selected = card.getAttribute('data-avatar');
      if (avatarInput) avatarInput.value = selected;

      avatarCards.forEach(function (c) { c.classList.remove('active'); });
      card.classList.add('active');

      if (customLogoContainer) {
        customLogoContainer.style.display = (selected === 'custom') ? 'block' : 'none';
      }
    });
  });

  // --- Pre-Chat Form Toggle ---
  var prechatToggle = document.getElementById('cp_prechat_enabled');
  var prechatPanel = document.getElementById('cp-prechat-options-panel');
  if (prechatToggle && prechatPanel) {
    prechatToggle.addEventListener('change', function () {
      prechatPanel.style.display = prechatToggle.checked ? 'block' : 'none';
    });
  }

  // --- Launcher Callout Toggle ---
  var calloutToggle = document.getElementById('cp_launcher_callout_enabled');
  var calloutPanel = document.getElementById('cp-launcher-callout-panel');
  if (calloutToggle && calloutPanel) {
    calloutToggle.addEventListener('change', function () {
      calloutPanel.style.display = calloutToggle.checked ? 'block' : 'none';
    });
  }
})();
