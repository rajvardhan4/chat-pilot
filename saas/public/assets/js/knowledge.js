/** Knowledge Base screen: upload, retrieval diagnostics, document toggles. */
(function () {
  'use strict';
  var api = window.cpApi;
  if (!api) return;

  /* ------------------------------------------------------------ upload -- */

  var uploadBtn = document.getElementById('cp-upload-btn');
  var uploadInput = document.getElementById('cp-upload-input');

  if (uploadBtn && uploadInput) {
    uploadBtn.addEventListener('click', function () {
      var file = uploadInput.files && uploadInput.files[0];
      if (!file) {
        window.cpToast('Choose a file to upload.', 'error');
        return;
      }
      window.cpBusy(uploadBtn, true, 'Uploading…');
      var reader = new FileReader();
      reader.onload = function () {
        var result = String(reader.result || '');
        var base64 = result.indexOf(',') >= 0 ? result.split(',')[1] : '';
        api.post(api.site('/knowledge/upload'), {
          filename: file.name,
          mime_type: file.type || '',
          content_base64: base64,
        })
          .then(function () {
            window.cpToast('Document imported.', 'success');
            setTimeout(function () { window.location.reload(); }, 700);
          })
          .catch(function (err) {
            window.cpToast(err.message, 'error');
            window.cpBusy(uploadBtn, false);
          });
      };
      reader.onerror = function () {
        window.cpToast('That file could not be read.', 'error');
        window.cpBusy(uploadBtn, false);
      };
      reader.readAsDataURL(file);
    });
  }

  /* --------------------------------------------- retrieval diagnostics -- */

  var retrievalBtn = document.getElementById('cp-retrieval-btn');
  var retrievalInput = document.getElementById('cp-retrieval-query');
  var retrievalOut = document.getElementById('cp-retrieval-results');

  if (retrievalBtn && retrievalInput && retrievalOut) {
    retrievalBtn.addEventListener('click', function () {
      var query = retrievalInput.value.trim();
      if (!query) return;
      window.cpBusy(retrievalBtn, true, 'Testing…');
      api.post(api.site('/knowledge/test-retrieval'), { query: query })
        .then(function (data) {
          if (!data.results.length) {
            retrievalOut.innerHTML =
              '<div class="cp-alert cp-alert-warning">No documents matched. A visitor asking this ' +
              'would receive your Missing Knowledge Fallback.</div>';
            return;
          }
          var html = '<p class="cp-help-text">Threshold: ' + data.threshold + '</p>';
          data.results.forEach(function (r) {
            html +=
              '<div class="cp-diag-item">' +
              '<div class="cp-diag-row"><span>' + escapeHtml(r.title) + '</span>' +
              '<span><span class="cp-pill ' + (r.aboveThreshold ? 'cp-pill-success' : 'cp-pill-warning') + '">' +
              r.score + '</span> <span class="cp-pill cp-pill-info">' + r.sourceType + '</span></span></div>' +
              '<p class="cp-muted" style="font-size:0.8rem; margin:0.4rem 0 0">' +
              escapeHtml(r.excerpt) + '…</p></div>';
          });
          retrievalOut.innerHTML = html;
        })
        .catch(function (err) { window.cpToast(err.message, 'error'); })
        .finally(function () { window.cpBusy(retrievalBtn, false); });
    });
  }

  /* -------------------------------------------------- document toggles -- */

  document.querySelectorAll('[data-toggle-doc]').forEach(function (button) {
    button.addEventListener('click', function () {
      var id = button.getAttribute('data-toggle-doc');
      var next = button.getAttribute('data-current') === 'enabled' ? 'disabled' : 'enabled';
      window.cpBusy(button, true, '…');
      api.post(api.site('/knowledge/documents/' + id + '/status'), { status: next })
        .then(function () {
          window.cpToast('Document ' + next + '.', 'success');
          setTimeout(function () { window.location.reload(); }, 500);
        })
        .catch(function (err) {
          window.cpToast(err.message, 'error');
          window.cpBusy(button, false);
        });
    });
  });

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
})();
