/** Chat Widget screen: live preview of the payload the plugin will receive. */
(function () {
  'use strict';
  var api = window.cpApi;
  var target = document.getElementById('cp-widget-preview');
  if (!api || !target) return;

  function refresh() {
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
})();
