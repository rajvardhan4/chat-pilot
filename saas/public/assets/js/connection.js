/** Connection screen: issue a Site API Key and reveal it exactly once. */
(function () {
  'use strict';
  var api = window.cpApi;
  var button = document.getElementById('cp-generate-key');
  var panel = document.getElementById('cp-new-key-panel');
  var value = document.getElementById('cp-new-key-value');
  if (!api || !button || !panel || !value) return;

  var labelInput = document.getElementById('cp-key-label');

  button.addEventListener('click', function () {
    // An inline field rather than window.prompt: prompt() is blocked outright
    // in sandboxed frames and several browsers, which would leave the customer
    // with a button that silently does nothing.
    var label = (labelInput && labelInput.value.trim()) || 'Primary';
    window.cpBusy(button, true, 'Generating…');
    api.post(api.site('/keys'), { label: label })
      .then(function (data) {
        value.textContent = data.key;
        panel.style.display = 'block';
        window.cpToast('Site API Key generated. Copy it now.', 'success');
        panel.scrollIntoView({ behavior: 'smooth' });
      })
      .catch(function (err) { window.cpToast(err.message, 'error'); })
      .finally(function () { window.cpBusy(button, false); });
  });
})();
