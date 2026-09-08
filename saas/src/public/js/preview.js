/** Developer Chat Preview: drives the same engine as the live widget. */
(function () {
  'use strict';
  var api = window.cpApi;
  if (!api) return;

  var stream = document.getElementById('cp-preview-stream');
  var form = document.getElementById('cp-preview-form');
  var input = document.getElementById('cp-preview-input');
  var diagnostics = document.getElementById('cp-preview-diagnostics');
  var resetBtn = document.getElementById('cp-preview-reset');
  if (!stream || !form || !input) return;

  var sessionKey = newSession();

  function newSession() {
    return 'preview_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function append(role, text) {
    var wrap = document.createElement('div');
    wrap.className = 'cp-chat-msg ' + (role === 'user' ? 'is-user' : 'is-bot');
    var bubble = document.createElement('div');
    bubble.className = 'cp-chat-bubble';
    bubble.textContent = text;
    wrap.appendChild(bubble);
    stream.appendChild(wrap);
    stream.scrollTop = stream.scrollHeight;
    return wrap;
  }

  function appendTyping() {
    var wrap = document.createElement('div');
    wrap.className = 'cp-chat-msg is-bot';
    wrap.id = 'cp-typing';
    wrap.innerHTML = '<div class="cp-chat-bubble"><span class="cp-typing"><i></i><i></i><i></i></span></div>';
    stream.appendChild(wrap);
    stream.scrollTop = stream.scrollHeight;
  }

  function removeTyping() {
    var el = document.getElementById('cp-typing');
    if (el) el.remove();
  }

  function row(label, value, pill) {
    return '<div class="cp-diag-row"><span>' + escapeHtml(label) + '</span><span>' +
      (pill ? '<span class="cp-pill ' + pill + '">' + escapeHtml(value) + '</span>' : escapeHtml(value)) +
      '</span></div>';
  }

  function renderDiagnostics(d, status) {
    if (!diagnostics) return;
    if (!d) {
      diagnostics.innerHTML = '<p class="cp-muted">No diagnostics returned.</p>';
      return;
    }

    var statusPill =
      status === 'success' ? 'cp-pill-success' :
      status === 'fallback' ? 'cp-pill-warning' : 'cp-pill-error';

    var html = '<div class="cp-diag-item">';
    html += row('Engine status', d.status, statusPill);
    html += row('Intent', d.intent);
    html += row('Confidence', d.confidence);
    html += row('Top score / threshold', d.topScore + ' / ' + d.threshold);
    html += row('Sources used', d.sourcesUsed);
    html += row('Context resolved', d.usedContext ? 'yes' : 'no', d.usedContext ? 'cp-pill-info' : '');
    if (d.usedContext) html += row('Search query', d.contextualQuery);
    if (d.topicSwitch) html += row('Topic switch', 'detected', 'cp-pill-purple');
    html += '</div>';

    html += '<div class="cp-diag-item">';
    html += row('Provider', d.provider || 'none');
    html += row('Model', d.model || 'none');
    html += row('Latency', d.latencyMs + ' ms');
    html += row('Input tokens', String(d.inputTokens));
    html += row('Output tokens', String(d.outputTokens));
    html += row('Total tokens', String(d.totalTokens));
    html += row('Estimated cost', '$' + Number(d.estimatedCost).toFixed(6));
    html += row('Prompt / context chars', d.promptChars + ' / ' + d.contextChars);
    html += '</div>';

    if (d.errorType) {
      html += '<div class="cp-diag-item">';
      html += row('Error category', d.errorLabel || d.errorType, 'cp-pill-error');
      html += row('HTTP status', String(d.httpStatus || 0));
      if (d.retryAfter) html += row('Retry after', d.retryAfter);
      html += row('Provider message', d.providerMessage || '');
      html += '</div>';
      html += '<p class="cp-help-text">Visitors never see this detail &mdash; they get your configured ' +
        'AI provider failure message.</p>';
    }

    if (d.documents && d.documents.length) {
      html += '<div class="cp-diag-item"><div class="cp-diag-row"><span>Retrieved documents</span>' +
        '<span>' + d.documents.length + '</span></div>';
      d.documents.forEach(function (doc) {
        html += '<div class="cp-diag-row"><span>' + escapeHtml(doc.title) + '</span>' +
          '<span><span class="cp-pill cp-pill-info">' + doc.sourceType + '</span> ' + doc.score + '</span></div>';
      });
      html += '</div>';
    }

    diagnostics.innerHTML = html;
  }

  // Enter must send. Implicit form submission is not reliable across every
  // browser and embedding, and this is the primary interaction on the screen,
  // so it is wired explicitly rather than assumed.
  input.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    }
  });

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var message = input.value.trim();
    if (!message) return;
    input.value = '';
    input.disabled = true;
    append('user', message);
    appendTyping();

    api.post(api.site('/preview/chat'), { session_key: sessionKey, message: message })
      .then(function (data) {
        removeTyping();
        append('bot', data.text);
        renderDiagnostics(data.diagnostics, data.status);
      })
      .catch(function (err) {
        removeTyping();
        append('bot', err.message);
        window.cpToast(err.message, 'error');
      })
      .finally(function () {
        input.disabled = false;
        input.focus();
      });
  });

  if (resetBtn) {
    resetBtn.addEventListener('click', function () {
      sessionKey = newSession();
      stream.innerHTML = '';
      append('bot', 'New preview session started. Conversation memory has been cleared.');
      if (diagnostics) diagnostics.innerHTML = '<p class="cp-muted">Send a message to see diagnostics.</p>';
    });
  }
})();
