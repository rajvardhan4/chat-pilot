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
  if (form) {
    form.addEventListener('submit', function () {
      setTimeout(refresh, 800);
    });
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

  // --- Color Text Syncing ---
  var primaryColorInput = document.getElementById('primary_color');
  var primaryColorText = document.getElementById('primary_color_text');
  if (primaryColorInput && primaryColorText) {
    primaryColorInput.addEventListener('input', function () {
      primaryColorText.value = primaryColorInput.value;
    });
  }

  var iconColorInput = document.getElementById('icon_color');
  var iconColorText = document.getElementById('icon_color_text');
  if (iconColorInput && iconColorText) {
    iconColorInput.addEventListener('input', function () {
      iconColorText.value = iconColorInput.value;
    });
  }

  // --- Pre-Chat Form Toggle ---
  var prechatToggle = document.getElementById('cp_prechat_enabled');
  var prechatPanel = document.getElementById('cp-prechat-options-panel');
  if (prechatToggle && prechatPanel) {
    prechatToggle.addEventListener('change', function () {
      prechatPanel.style.display = prechatToggle.checked ? 'block' : 'none';
    });
  }
})();
