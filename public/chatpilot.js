/**
 * Chat Pilot Universal Embed Script (chatpilot.js)
 *
 * Self-contained, zero-dependency browser widget.
 * Works on any website platform: Shopify, Wix, Squarespace, Webflow, WPBakery, Elementor, and custom HTML/PHP/React.
 *
 * Usage:
 * <script src="https://appchatpilot.vercel.app/chatpilot.js" data-site-id="YOUR_SITE_ID" async></script>
 */
(function () {
  'use strict';

  if (window.__ChatPilotWidgetLoaded) return;
  window.__ChatPilotWidgetLoaded = true;

  // Safe localStorage helper (handles private browsing / blocked storage)
  function storageGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function storageSet(key, val) {
    try {
      window.localStorage.setItem(key, val);
    } catch (e) {}
  }

  // Find calling script element
  var currentScript = document.currentScript || (function () {
    var scripts = document.getElementsByTagName('script');
    for (var i = scripts.length - 1; i >= 0; i--) {
      var s = scripts[i];
      if (s.src && (s.src.indexOf('chatpilot.js') !== -1 || s.src.indexOf('embed.js') !== -1 || s.getAttribute('data-site-id'))) {
        return s;
      }
    }
    return null;
  })();

  var siteId = '';
  if (currentScript) {
    siteId = currentScript.getAttribute('data-site-id') || '';
  }
  if (!siteId && window.ChatPilotSiteId) {
    siteId = window.ChatPilotSiteId;
  }
  if (!siteId && window.ChatPilotConfig && window.ChatPilotConfig.siteId) {
    siteId = window.ChatPilotConfig.siteId;
  }

  if (!siteId) {
    console.warn('[Chat Pilot] Widget script loaded without data-site-id attribute.');
    return;
  }

  // Derive API endpoint
  var apiHost = 'https://appchatpilot.vercel.app';
  if (currentScript && currentScript.src) {
    try {
      var u = new URL(currentScript.src);
      apiHost = u.origin;
    } catch (e) {}
  }

  // Session ID
  var sessionId = storageGet('cp_session_id');
  if (!sessionId || sessionId.length < 12) {
    sessionId = 'cp_sess_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    storageSet('cp_session_id', sessionId);
  }

  // Escape HTML helper
  function escapeHtml(str) {
    return String(str === null || str === undefined ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Format bot markdown output
  function formatBotOutput(text) {
    if (!text) return '';
    var formatted = escapeHtml(text);

    // [action:Label](url)
    formatted = formatted.replace(/\[action:([^\]]+)\]\((https?:\/\/[^\s\)]+)\)/gi, function (_, label, url) {
      return '<a href="' + url + '" target="_blank" rel="noopener noreferrer" class="cp-action-btn">' + label + ' &nearr;</a>';
    });

    // [Label](url)
    formatted = formatted.replace(/\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)/gi, function (_, label, url) {
      return '<a href="' + url + '" target="_blank" rel="noopener noreferrer" class="cp-link">' + label + ' &nearr;</a>';
    });

    formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    formatted = formatted.replace(/(?:^|\n)\s*-\s+(.*?)(?=\n|$)/g, '<br>&bull; $1');
    formatted = formatted.replace(/\n/g, '<br>');

    if (formatted.indexOf('<br>') === 0) {
      formatted = formatted.substring(4);
    }
    return formatted;
  }

  // Fetch widget configuration from SaaS public API
  fetch(apiHost + '/api/v1/public/widget/' + encodeURIComponent(siteId), {
    method: 'GET',
    headers: { 'Accept': 'application/json' },
  })
    .then(function (res) {
      if (!res.ok) throw new Error('Failed to load widget config: ' + res.status);
      return res.json();
    })
    .then(function (res) {
      if (!res || !res.ok || !res.data) return;

      var data = res.data;
      var website = data.website || {};
      var widget = data.widget || {};
      var messages = data.messages || {};

      // If website inactive or widget disabled, do nothing
      if (website.status !== 'active' || widget.enabled === false) {
        return;
      }

      // Ready to initialize
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
          initWidget(widget, messages, website);
        });
      } else {
        initWidget(widget, messages, website);
      }
    })
    .catch(function (err) {
      console.warn('[Chat Pilot] Could not initialize widget:', err.message);
    });

  function initWidget(widget, messages, website) {
    var primaryColor = widget.primaryColor || '#0678f9';
    var iconColor = widget.iconColor || '#ffffff';
    var calloutBg = widget.launcherCalloutBg || '#16213a';
    var calloutColor = widget.launcherCalloutColor || '#ffffff';
    var position = widget.position || 'bottom-right';
    var displayName = widget.displayName || website.name || 'Chat Pilot';
    var welcomeMessage = widget.welcomeMessage || 'Hi there! How can I help you today?';
    var placeholderText = widget.placeholderText || 'Ask a question...';
    var suggestedQuestions = Array.isArray(widget.suggestedQuestions) ? widget.suggestedQuestions : [];
    var enableTyping = widget.enableTyping !== false;
    var enableStreaming = widget.enableStreaming !== false;
    var autoOpenChat = Boolean(widget.autoOpenChat);
    var autoOpenDelay = Number(widget.autoOpenDelay || 5);
    var openOncePerVisitor = widget.openOncePerVisitor !== false;
    var calloutEnabled = widget.launcherCalloutEnabled !== false;
    var calloutText = widget.launcherCalloutText || 'Ask any question 👋';
    var prechat = widget.prechat || { enabled: false, fields: [] };
    var hasPrechat = Boolean(prechat.enabled && prechat.fields && prechat.fields.length > 0);
    var formId = prechat.formId || '';
    var intro = prechat.intro || 'Please introduce yourself to start the conversation.';
    var logoUrl = widget.logoUrl || '';
    var fallbackError = messages.generation_error || messages.fallback || "I'm having trouble responding right now. Please try again in a moment.";

    // Inject CSS
    if (!document.getElementById('chat-pilot-embed-css')) {
      var styleEl = document.createElement('style');
      styleEl.id = 'chat-pilot-embed-css';
      styleEl.textContent = [
        ':root, #chat-pilot-widget-container {',
        '  --cp-primary-color: ' + primaryColor + ';',
        '  --cp-icon-color: ' + iconColor + ';',
        '  --cp-callout-bg: ' + calloutBg + ';',
        '  --cp-callout-color: ' + calloutColor + ';',
        '}',
        '#chat-pilot-widget-container {',
        '  position: fixed;',
        '  bottom: 24px;',
        '  z-index: 9999999;',
        '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;',
        '  color: #cbd5e1;',
        '  display: flex;',
        '  flex-direction: column;',
        '  -webkit-font-smoothing: antialiased;',
        '  -moz-osx-font-smoothing: grayscale;',
        '  box-sizing: border-box;',
        '}',
        '#chat-pilot-widget-container * { box-sizing: border-box; }',
        '#chat-pilot-widget-container.cp-pos-bottom-right { right: 24px; align-items: flex-end; }',
        '#chat-pilot-widget-container.cp-pos-bottom-left { left: 24px; align-items: flex-start; }',
        '#chat-pilot-widget-container.cp-pos-bottom-left #chat-pilot-widget-box { transform-origin: bottom left; }',
        '',
        '/* Callout Bubble */',
        '.cp-launcher-callout {',
        '  background: var(--cp-callout-bg, #16213a) !important;',
        '  border: 1px solid rgba(255, 255, 255, 0.15);',
        '  border-radius: 24px;',
        '  box-shadow: 0 14px 34px -4px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.05);',
        '  color: var(--cp-callout-color, #ffffff) !important;',
        '  padding: 0.6rem 0.95rem 0.6rem 1.05rem;',
        '  font-size: 0.86rem;',
        '  font-weight: 600;',
        '  letter-spacing: 0.01em;',
        '  display: inline-flex;',
        '  align-items: center;',
        '  gap: 0.55rem;',
        '  cursor: pointer;',
        '  margin-bottom: 12px;',
        '  position: relative;',
        '  backdrop-filter: blur(16px);',
        '  -webkit-backdrop-filter: blur(16px);',
        '  user-select: none;',
        '  white-space: nowrap;',
        '  animation: cpCalloutFloat 3.5s ease-in-out infinite, cpFadeIn 0.35s ease-out;',
        '  transition: transform 0.25s ease, box-shadow 0.25s ease;',
        '}',
        '.cp-launcher-callout:hover { transform: translateY(-3px) scale(1.02); }',
        '.cp-launcher-callout::after {',
        '  content: "";',
        '  position: absolute;',
        '  bottom: -6px;',
        '  width: 10px;',
        '  height: 10px;',
        '  background: var(--cp-callout-bg, #16213a) !important;',
        '  border-right: 1px solid rgba(255, 255, 255, 0.15);',
        '  border-bottom: 1px solid rgba(255, 255, 255, 0.15);',
        '  transform: rotate(45deg);',
        '}',
        '.cp-pos-bottom-right .cp-launcher-callout::after { right: 25px; }',
        '.cp-pos-bottom-left .cp-launcher-callout::after { left: 25px; }',
        '.cp-callout-pulse-dot {',
        '  width: 8px;',
        '  height: 8px;',
        '  border-radius: 50%;',
        '  background: #22c55e;',
        '  box-shadow: 0 0 8px #22c55e;',
        '  display: inline-block;',
        '  flex-shrink: 0;',
        '  animation: cpDotGlow 2s infinite ease-in-out;',
        '}',
        '.cp-callout-text { color: var(--cp-callout-color, inherit) !important; font-weight: 600; font-size: 0.86rem; }',
        '#chat-pilot-callout-close {',
        '  background: rgba(255, 255, 255, 0.12);',
        '  border: none;',
        '  color: #94a3b8;',
        '  width: 18px;',
        '  height: 18px;',
        '  border-radius: 50%;',
        '  display: inline-flex;',
        '  align-items: center;',
        '  justify-content: center;',
        '  font-size: 13px;',
        '  line-height: 1;',
        '  cursor: pointer;',
        '  padding: 0;',
        '  margin-left: 4px;',
        '  transition: all 0.2s ease;',
        '}',
        '#chat-pilot-callout-close:hover { background: rgba(255, 255, 255, 0.3); color: #fff; }',
        '',
        '/* Launcher Button */',
        '#chat-pilot-widget-launcher {',
        '  width: 60px;',
        '  height: 60px;',
        '  border-radius: 50%;',
        '  background: var(--cp-primary-color, #0678f9) !important;',
        '  border: 2px solid rgba(255, 255, 255, 0.2);',
        '  box-shadow: 0 10px 28px -4px rgba(0, 0, 0, 0.45);',
        '  cursor: pointer;',
        '  display: flex;',
        '  align-items: center;',
        '  justify-content: center;',
        '  color: var(--cp-icon-color, #ffffff);',
        '  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.3s ease;',
        '  outline: none;',
        '  padding: 0;',
        '}',
        '#chat-pilot-widget-launcher:hover { transform: scale(1.08) rotate(3deg); }',
        '#chat-pilot-widget-launcher svg { width: 28px; height: 28px; stroke: currentColor; fill: none; stroke-width: 2; }',
        '.cp-launcher-avatar-img { width: 44px; height: 44px; border-radius: 50%; object-fit: cover; }',
        '',
        '/* Chat Box Window */',
        '#chat-pilot-widget-box {',
        '  width: 380px;',
        '  height: 600px;',
        '  max-height: calc(100vh - 100px);',
        '  background: linear-gradient(165deg, rgba(20, 29, 47, 0.97) 0%, rgba(11, 17, 32, 0.99) 100%);',
        '  backdrop-filter: blur(24px);',
        '  -webkit-backdrop-filter: blur(24px);',
        '  border: 1px solid rgba(255, 255, 255, 0.12);',
        '  border-radius: 20px;',
        '  box-shadow: 0 25px 60px -15px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.08);',
        '  display: flex;',
        '  flex-direction: column;',
        '  overflow: hidden;',
        '  animation: cpSlideUp 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);',
        '  transform-origin: bottom right;',
        '}',
        '#chat-pilot-widget-container.cp-open #chat-pilot-widget-launcher,',
        '#chat-pilot-widget-container.cp-open #chat-pilot-launcher-callout { display: none !important; }',
        '',
        '/* Header */',
        '.cp-widget-header {',
        '  background: linear-gradient(180deg, rgba(30, 45, 75, 0.85) 0%, rgba(18, 27, 46, 0.75) 100%);',
        '  border-bottom: 1px solid rgba(255, 255, 255, 0.08);',
        '  padding: 1rem 1.25rem;',
        '  display: flex;',
        '  justify-content: space-between;',
        '  align-items: center;',
        '}',
        '.cp-widget-brand { display: flex; align-items: center; gap: 0.75rem; }',
        '.cp-widget-avatar-wrap { position: relative; width: 38px; height: 38px; flex-shrink: 0; }',
        '.cp-widget-logo { width: 38px; height: 38px; border-radius: 50%; object-fit: cover; border: 1px solid rgba(255, 255, 255, 0.2); }',
        '.cp-widget-logo-placeholder { width: 38px; height: 38px; border-radius: 50%; background: rgba(255, 255, 255, 0.08); display: flex; align-items: center; justify-content: center; font-size: 1.25rem; border: 1px solid rgba(255, 255, 255, 0.12); }',
        '.cp-status-dot-pulse { width: 10px; height: 10px; border-radius: 50%; background: #22c55e; border: 2px solid #0f172a; box-shadow: 0 0 6px #22c55e; position: absolute; bottom: -1px; right: -1px; }',
        '.cp-widget-brand-text { display: flex; flex-direction: column; gap: 2px; }',
        '.cp-widget-title { font-size: 0.98rem; font-weight: 700; color: #ffffff; margin: 0; line-height: 1.2; }',
        '.cp-subtitle-badge { display: inline-flex; align-items: center; gap: 3px; font-size: 0.7rem; font-weight: 600; color: var(--cp-primary-color, #0678f9); text-transform: uppercase; letter-spacing: 0.05em; }',
        '#chat-pilot-widget-close { width: 30px; height: 30px; border-radius: 50%; background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.08); color: #94a3b8; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 0; transition: all 0.2s ease; }',
        '#chat-pilot-widget-close:hover { background: rgba(255, 255, 255, 0.16); color: #ffffff; }',
        '',
        '/* Body */',
        '.cp-widget-body { flex-grow: 1; overflow-y: auto; padding: 1.15rem 1.25rem; display: flex; flex-direction: column; gap: 1rem; scroll-behavior: smooth; }',
        '.cp-widget-body::-webkit-scrollbar { width: 5px; }',
        '.cp-widget-body::-webkit-scrollbar-track { background: transparent; }',
        '.cp-widget-body::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.1); border-radius: 4px; }',
        '',
        '/* Prechat Form */',
        '#cp-widget-prechat-form { display: flex; flex-direction: column; gap: 0.85rem; }',
        '.cp-widget-prechat-intro-card { background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 12px; padding: 0.75rem 0.95rem; color: #cbd5e1; display: flex; align-items: center; gap: 0.5rem; }',
        '.cp-widget-prechat-intro { font-size: 0.86rem; color: #cbd5e1; margin: 0; line-height: 1.4; }',
        '.cp-prechat-error-msg { display: none; color: #ef4444; font-size: 0.82rem; border: 1px solid rgba(239, 68, 68, 0.25); background: rgba(239, 68, 68, 0.1); padding: 0.5rem 0.75rem; border-radius: 8px; line-height: 1.4; }',
        '.cp-widget-form-group { display: flex; flex-direction: column; gap: 0.3rem; }',
        '.cp-widget-form-group label { font-size: 0.78rem; font-weight: 600; color: #cbd5e1; }',
        '.cp-required-star { color: #f43f5e; font-weight: 700; }',
        '.cp-widget-input { background: rgba(15, 23, 42, 0.7) !important; border: 1px solid rgba(255, 255, 255, 0.12) !important; border-radius: 10px !important; color: #ffffff !important; padding: 0.65rem 0.85rem !important; font-size: 0.9rem !important; font-family: inherit !important; outline: none !important; width: 100% !important; transition: border-color 0.2s ease !important; }',
        '.cp-widget-input:focus { border-color: var(--cp-primary-color, #0678f9) !important; box-shadow: 0 0 0 2px rgba(6, 120, 249, 0.25) !important; }',
        '.cp-widget-input::placeholder { color: #64748b; }',
        '.cp-widget-btn, #cp-widget-prechat-submit { background: var(--cp-primary-color, #0678f9); border: none; border-radius: 10px; color: var(--cp-icon-color, #ffffff); padding: 0.75rem 1.15rem; font-size: 0.92rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 0.5rem; box-shadow: 0 6px 18px -2px rgba(0, 0, 0, 0.45); transition: transform 0.2s ease, filter 0.2s ease; margin-top: 0.4rem; }',
        '.cp-widget-btn:hover, #cp-widget-prechat-submit:hover { transform: translateY(-1px); filter: brightness(1.08); }',
        '',
        '/* Messages */',
        '#cp-widget-messages { display: flex; flex-direction: column; gap: 0.85rem; width: 100%; }',
        '.cp-widget-msg { display: flex; gap: 0.5rem; max-width: 86%; animation: cpFadeIn 0.2s ease-out; }',
        '.cp-widget-msg.cp-msg-bot { align-self: flex-start; }',
        '.cp-widget-msg.cp-msg-user { align-self: flex-end; flex-direction: row-reverse; max-width: 82%; }',
        '.cp-msg-bubble { padding: 0.75rem 1rem; border-radius: 15px; font-size: 0.88rem; line-height: 1.48; word-break: break-word; }',
        '.cp-msg-bot .cp-msg-bubble { background: rgba(30, 41, 59, 0.75); border: 1px solid rgba(255, 255, 255, 0.08); color: #f1f5f9; border-top-left-radius: 4px; }',
        '.cp-msg-user .cp-msg-bubble { background: var(--cp-primary-color, #0678f9); color: var(--cp-icon-color, #ffffff); border-top-right-radius: 4px; }',
        '.cp-action-btn { display: inline-block; margin: 6px 0; padding: 6px 14px; background: var(--cp-primary-color, #0678f9); color: #fff !important; font-weight: 600; font-size: 13px; border-radius: 6px; text-decoration: none !important; box-shadow: 0 1px 3px rgba(0,0,0,0.2); }',
        '.cp-link { color: #38bdf8 !important; text-decoration: underline !important; font-weight: 600; }',
        '',
        '/* Suggestions */',
        '.cp-widget-suggestions { display: flex; flex-direction: column; gap: 0.5rem; align-self: flex-start; margin-top: 0.25rem; }',
        '.cp-widget-suggest-btn { background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 18px; padding: 0.5rem 0.95rem; color: #cbd5e1; font-size: 0.82rem; font-weight: 500; cursor: pointer; text-align: left; transition: all 0.2s ease; width: fit-content; }',
        '.cp-widget-suggest-btn:hover { background: rgba(255, 255, 255, 0.1); border-color: var(--cp-primary-color, #0678f9); color: #ffffff; transform: translateX(3px); }',
        '',
        '/* Typing Indicator */',
        '.cp-typing-indicator { display: flex; align-items: center; gap: 4px; padding: 0.3rem 0.2rem; }',
        '.cp-typing-dot { width: 6px; height: 6px; border-radius: 50%; background: #94a3b8; animation: cpDotPulse 1.4s infinite ease-in-out both; }',
        '.cp-typing-dot:nth-child(1) { animation-delay: -0.32s; }',
        '.cp-typing-dot:nth-child(2) { animation-delay: -0.16s; }',
        '',
        '/* Footer */',
        '.cp-widget-footer { padding: 0.85rem 1.15rem; border-top: 1px solid rgba(255, 255, 255, 0.07); background: rgba(15, 23, 42, 0.95); }',
        '#cp-widget-input-form { display: flex; gap: 0.5rem; align-items: center; margin: 0; }',
        '#cp-widget-input-field { flex-grow: 1; border-radius: 10px !important; }',
        '#cp-widget-send-btn { width: 38px; height: 38px; border-radius: 10px; background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.1); color: #94a3b8; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 0; flex-shrink: 0; transition: all 0.2s ease; }',
        '#cp-widget-send-btn:hover { background: var(--cp-primary-color, #0678f9); border-color: var(--cp-primary-color, #0678f9); color: var(--cp-icon-color, #ffffff); }',
        '#cp-widget-send-btn svg { width: 16px; height: 16px; }',
        '.cp-widget-branding-tag { font-size: 0.68rem; color: #475569; text-align: center; margin-top: 0.5rem; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 500; }',
        '',
        '/* Animations */',
        '@keyframes cpSlideUp { from { opacity: 0; transform: translateY(20px) scale(0.96); } to { opacity: 1; transform: translateY(0) scale(1); } }',
        '@keyframes cpFadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }',
        '@keyframes cpCalloutFloat { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }',
        '@keyframes cpDotGlow { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.5; transform: scale(0.85); } }',
        '@keyframes cpDotPulse { 0%, 80%, 100% { transform: scale(0); opacity: 0.3; } 40% { transform: scale(1); opacity: 1; } }',
        '',
        '/* Mobile Responsiveness */',
        '@media (max-width: 480px) {',
        '  #chat-pilot-widget-container { bottom: 0 !important; right: 0 !important; left: 0 !important; width: 100% !important; align-items: stretch !important; }',
        '  #chat-pilot-widget-launcher { margin: 0 16px 16px auto; }',
        '  .cp-launcher-callout { margin: 0 16px 10px auto; }',
        '  #chat-pilot-widget-container.cp-pos-bottom-left #chat-pilot-widget-launcher,',
        '  #chat-pilot-widget-container.cp-pos-bottom-left .cp-launcher-callout { margin: 0 auto 16px 16px; }',
        '  #chat-pilot-widget-box { width: 100% !important; height: 100vh !important; max-height: 100vh !important; border-radius: 0 !important; border: none !important; }',
        '}',
      ].join('\n');
      document.head.appendChild(styleEl);
    }

    // Determine initial prechat status
    var isPrechatDone = formId ? storageGet('cp_prechat_done_' + formId) === 'yes' : true;
    var showPrechatNow = hasPrechat && !isPrechatDone;

    // Build DOM
    var container = document.createElement('div');
    container.id = 'chat-pilot-widget-container';
    container.className = 'cp-pos-' + (position === 'bottom-left' ? 'bottom-left' : 'bottom-right');
    container.style.cssText = '--cp-primary-color: ' + primaryColor + '; --cp-icon-color: ' + iconColor + '; --cp-callout-bg: ' + calloutBg + '; --cp-callout-color: ' + calloutColor + ';';

    var calloutHtml = '';
    if (calloutEnabled && storageGet('cp_callout_dismissed') !== 'yes') {
      calloutHtml = [
        '<div id="chat-pilot-launcher-callout" class="cp-launcher-callout" role="button" aria-label="' + escapeHtml(calloutText) + '">',
        '  <span class="cp-callout-pulse-dot"></span>',
        '  <span class="cp-callout-text">' + escapeHtml(calloutText) + '</span>',
        '  <button type="button" id="chat-pilot-callout-close" aria-label="Dismiss callout">&times;</button>',
        '</div>',
      ].join('\n');
    }

    var avatarImgHtml = logoUrl
      ? '<img src="' + escapeHtml(logoUrl) + '" alt="' + escapeHtml(displayName) + '" class="cp-widget-logo">'
      : '<div class="cp-widget-logo-placeholder">&#129302;</div>';

    var launcherInner = '<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>';
    if (widget.launcherIconType === 'avatar' && logoUrl) {
      launcherInner = '<img src="' + escapeHtml(logoUrl) + '" alt="' + escapeHtml(displayName) + '" class="cp-launcher-avatar-img">';
    }

    var prechatFieldsHtml = '';
    if (hasPrechat && prechat.fields) {
      prechat.fields.forEach(function (f) {
        var fid = escapeHtml(f.key || '');
        var ftype = f.type || 'text';
        var flabel = escapeHtml(f.label || '');
        var fplace = escapeHtml(f.placeholder || '');
        var req = Boolean(f.required);
        var reqStar = req ? ' <span class="cp-required-star">*</span>' : '';
        var reqAttr = req ? 'required' : '';

        prechatFieldsHtml += '<div class="cp-widget-form-group">';
        prechatFieldsHtml += '<label for="cp-prechat-' + fid + '">' + flabel + reqStar + '</label>';
        if (ftype === 'textarea') {
          prechatFieldsHtml += '<textarea id="cp-prechat-' + fid + '" class="cp-widget-input cp-prechat-field" placeholder="' + fplace + '" ' + reqAttr + ' style="min-height:55px; resize:vertical;"></textarea>';
        } else if (ftype === 'dropdown' && f.options && f.options.length) {
          prechatFieldsHtml += '<select id="cp-prechat-' + fid + '" class="cp-widget-input cp-prechat-field" ' + reqAttr + '>';
          prechatFieldsHtml += '<option value="">-- Select --</option>';
          f.options.forEach(function (opt) {
            prechatFieldsHtml += '<option value="' + escapeHtml(opt) + '">' + escapeHtml(opt) + '</option>';
          });
          prechatFieldsHtml += '</select>';
        } else {
          prechatFieldsHtml += '<input type="' + (ftype === 'email' ? 'email' : (ftype === 'phone' ? 'tel' : 'text')) + '" id="cp-prechat-' + fid + '" class="cp-widget-input cp-prechat-field" placeholder="' + fplace + '" ' + reqAttr + '>';
        }
        prechatFieldsHtml += '</div>';
      });
    }

    var suggestionsHtml = '';
    if (suggestedQuestions.length > 0) {
      suggestionsHtml = '<div class="cp-widget-suggestions">';
      suggestedQuestions.forEach(function (q) {
        suggestionsHtml += '<button type="button" class="cp-widget-suggest-btn">' + escapeHtml(q) + '</button>';
      });
      suggestionsHtml += '</div>';
    }

    container.innerHTML = [
      calloutHtml,
      '<button id="chat-pilot-widget-launcher" aria-label="Open Chat">' + launcherInner + '</button>',
      '<div id="chat-pilot-widget-box" style="display: none;">',
      '  <div class="cp-widget-header">',
      '    <div class="cp-widget-brand">',
      '      <div class="cp-widget-avatar-wrap">',
      '        ' + avatarImgHtml,
      '        <span class="cp-status-dot-pulse" title="Online"></span>',
      '      </div>',
      '      <div class="cp-widget-brand-text">',
      '        <h3 class="cp-widget-title">' + escapeHtml(displayName) + '</h3>',
      '        <span class="cp-subtitle-badge">✦ AI Assistant</span>',
      '      </div>',
      '    </div>',
      '    <button id="chat-pilot-widget-close" aria-label="Close Chat">',
      '      <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>',
      '    </button>',
      '  </div>',
      '  <div class="cp-widget-body">',
      showPrechatNow ? [
        '    <div id="cp-widget-prechat-form" data-form-id="' + escapeHtml(formId) + '">',
        '      <div class="cp-widget-prechat-intro-card">',
        '        <span>👋</span>',
        '        <p class="cp-widget-prechat-intro">' + escapeHtml(intro) + '</p>',
        '      </div>',
        '      <div class="cp-prechat-error-msg"></div>',
        prechatFieldsHtml,
        '      <button type="button" id="cp-widget-prechat-submit" class="cp-widget-btn">',
        '        <span>Start Chat</span>',
        '        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>',
        '      </button>',
        '    </div>',
      ].join('\n') : '',
      '    <div id="cp-widget-messages" style="' + (showPrechatNow ? 'display: none;' : '') + '">',
      '      <div class="cp-widget-msg cp-msg-bot">',
      '        <div class="cp-msg-bubble">' + escapeHtml(welcomeMessage) + '</div>',
      '      </div>',
      suggestionsHtml,
      '    </div>',
      '  </div>',
      '  <div class="cp-widget-footer" style="' + (showPrechatNow ? 'display: none;' : '') + '">',
      '    <form id="cp-widget-input-form">',
      '      <input type="text" id="cp-widget-input-field" class="cp-widget-input" placeholder="' + escapeHtml(placeholderText) + '" autocomplete="off">',
      '      <button type="submit" id="cp-widget-send-btn" aria-label="Send Message">',
      '        <svg viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>',
      '      </button>',
      '    </form>',
      '    <div class="cp-widget-branding-tag">Powered by Chat Pilot</div>',
      '  </div>',
      '</div>',
    ].join('\n');

    document.body.appendChild(container);

    // Grab elements
    var launcher = document.getElementById('chat-pilot-widget-launcher');
    var box = document.getElementById('chat-pilot-widget-box');
    var closeBtn = document.getElementById('chat-pilot-widget-close');
    var callout = document.getElementById('chat-pilot-launcher-callout');
    var calloutClose = document.getElementById('chat-pilot-callout-close');
    var messages = document.getElementById('cp-widget-messages');
    var footer = container.querySelector('.cp-widget-footer');
    var inputForm = document.getElementById('cp-widget-input-form');
    var inputField = document.getElementById('cp-widget-input-field');
    var sendBtn = document.getElementById('cp-widget-send-btn');
    var prechatForm = document.getElementById('cp-widget-prechat-form');
    var prechatSubmit = document.getElementById('cp-widget-prechat-submit');

    var isRequestActive = false;

    function openWidget(immediate) {
      if (callout) callout.style.display = 'none';
      launcher.style.display = 'none';
      container.classList.add('cp-open');
      box.style.display = 'flex';
      scrollToBottom();
      storageSet('cp_widget_state', 'open');
      if (!prechatForm || prechatForm.style.display === 'none') {
        if (!immediate) inputField.focus();
      }
    }

    function closeWidget() {
      box.style.display = 'none';
      container.classList.remove('cp-open');
      launcher.style.display = 'flex';
      if (callout && storageGet('cp_callout_dismissed') !== 'yes') {
        callout.style.display = 'inline-flex';
      }
      storageSet('cp_widget_state', 'closed');
    }

    // Callout dismissal & click
    if (callout) {
      callout.addEventListener('click', function (e) {
        if (e.target.closest('#chat-pilot-callout-close')) return;
        openWidget(false);
      });
      if (calloutClose) {
        calloutClose.addEventListener('click', function (e) {
          e.stopPropagation();
          callout.style.display = 'none';
          storageSet('cp_callout_dismissed', 'yes');
        });
      }
    }

    // Launcher click
    launcher.addEventListener('click', function () {
      if (box.style.display === 'none') {
        openWidget(false);
      } else {
        closeWidget();
      }
    });

    closeBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      closeWidget();
    });

    // Auto-open logic
    var savedState = storageGet('cp_widget_state');
    if (savedState === 'open') {
      openWidget(true);
    } else if (savedState === null && autoOpenChat && autoOpenDelay > 0) {
      var hasAutoOpened = storageGet('cp_widget_has_auto_opened');
      if (!openOncePerVisitor || hasAutoOpened !== 'yes') {
        setTimeout(function () {
          if (storageGet('cp_widget_state') === null) {
            openWidget(false);
            if (openOncePerVisitor) {
              storageSet('cp_widget_has_auto_opened', 'yes');
            }
          }
        }, autoOpenDelay * 1000);
      }
    }

    // Pre-chat form submission
    if (prechatSubmit && prechatForm) {
      prechatSubmit.addEventListener('click', function () {
        var fieldsData = {};
        var errorMessages = [];
        var errorContainer = prechatForm.querySelector('.cp-prechat-error-msg');
        errorContainer.style.display = 'none';
        errorContainer.innerHTML = '';

        var fieldEls = prechatForm.querySelectorAll('.cp-prechat-field');
        fieldEls.forEach(function (el) {
          var fid = el.id.replace('cp-prechat-', '');
          var val = el.value.trim();
          var isReq = el.hasAttribute('required');
          var labelEl = prechatForm.querySelector('label[for="' + el.id + '"]');
          var labelText = labelEl ? labelEl.textContent.replace('*', '').trim() : fid;

          if (isReq && !val) {
            errorMessages.push('The field "' + labelText + '" is required.');
          } else if (val) {
            if (el.type === 'email' && !/\S+@\S+\.\S+/.test(val)) {
              errorMessages.push('Please enter a valid email address for "' + labelText + '".');
            }
            if (el.type === 'tel' && val.replace(/[^0-9]/g, '').length < 5) {
              errorMessages.push('Please enter a valid phone number for "' + labelText + '".');
            }
          }
          fieldsData[fid] = val;
        });

        if (errorMessages.length > 0) {
          var html = '<strong>Please correct the following:</strong><ul style="margin:4px 0 0 16px; padding:0;">';
          errorMessages.forEach(function (m) {
            html += '<li>' + escapeHtml(m) + '</li>';
          });
          html += '</ul>';
          errorContainer.innerHTML = html;
          errorContainer.style.display = 'block';
          return;
        }

        prechatSubmit.disabled = true;
        prechatSubmit.textContent = 'Starting...';

        fetch(apiHost + '/api/v1/public/forms/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({
            website_id: siteId,
            form_id: formId,
            session_key: sessionId,
            page_url: window.location.href,
            fields: fieldsData,
          }),
        })
          .then(function (r) { return r.json(); })
          .then(function (resp) {
            prechatSubmit.disabled = false;
            prechatSubmit.textContent = 'Start Chat';

            if (resp && resp.ok) {
              if (fieldsData.name) storageSet('cp_visitor_name', fieldsData.name);
              if (fieldsData.email) storageSet('cp_visitor_email', fieldsData.email);
              if (fieldsData.phone) storageSet('cp_visitor_phone', fieldsData.phone);
              if (formId) storageSet('cp_prechat_done_' + formId, 'yes');

              prechatForm.style.display = 'none';
              messages.style.display = 'flex';
              footer.style.display = 'block';
              scrollToBottom();
              inputField.focus();
            } else {
              errorContainer.textContent = (resp && resp.message) || 'Submission failed. Please try again.';
              errorContainer.style.display = 'block';
            }
          })
          .catch(function () {
            prechatSubmit.disabled = false;
            prechatSubmit.textContent = 'Start Chat';
            errorContainer.textContent = 'Could not start chat. Please check your connection.';
            errorContainer.style.display = 'block';
          });
      });
    }

    // Chat Message Sending
    inputForm.addEventListener('submit', function (e) {
      e.preventDefault();
      if (isRequestActive) return;

      var text = inputField.value.trim();
      if (!text) return;

      appendUserMessage(text);
      inputField.value = '';
      toggleLock(true);
      showTypingIndicator();

      fetch(apiHost + '/api/v1/public/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
          website_id: siteId,
          session_key: sessionId,
          message: text,
          page_url: window.location.href,
          visitor_name: storageGet('cp_visitor_name') || '',
          visitor_email: storageGet('cp_visitor_email') || '',
          visitor_phone: storageGet('cp_visitor_phone') || '',
        }),
      })
        .then(function (r) { return r.json(); })
        .then(function (resp) {
          removeTypingIndicator();
          if (resp && resp.ok && resp.data && resp.data.text) {
            if (enableStreaming) {
              streamResponse(resp.data.text);
            } else {
              appendBotMessage(resp.data.text);
              toggleLock(false);
            }
          } else {
            var msg = (resp && resp.message) || fallbackError;
            appendBotMessage(msg);
            toggleLock(false);
          }
        })
        .catch(function () {
          removeTypingIndicator();
          appendBotMessage(fallbackError);
          toggleLock(false);
        });
    });

    // Suggested questions click
    container.addEventListener('click', function (e) {
      if (e.target && e.target.classList.contains('cp-widget-suggest-btn')) {
        inputField.value = e.target.textContent.trim();
        inputForm.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
      }
    });

    function toggleLock(lock) {
      isRequestActive = lock;
      inputField.disabled = lock;
      sendBtn.disabled = lock;
      if (!lock) inputField.focus();
    }

    function appendUserMessage(text) {
      removeSuggestions();
      var msgDiv = document.createElement('div');
      msgDiv.className = 'cp-widget-msg cp-msg-user';
      msgDiv.innerHTML = '<div class="cp-msg-bubble">' + escapeHtml(text) + '</div>';
      messages.appendChild(msgDiv);
      scrollToBottom();
    }

    function appendBotMessage(text) {
      var msgDiv = document.createElement('div');
      msgDiv.className = 'cp-widget-msg cp-msg-bot';
      msgDiv.innerHTML = '<div class="cp-msg-bubble">' + formatBotOutput(text) + '</div>';
      messages.appendChild(msgDiv);
      scrollToBottom();
    }

    function streamResponse(text) {
      removeSuggestions();
      var msgDiv = document.createElement('div');
      msgDiv.className = 'cp-widget-msg cp-msg-bot';
      msgDiv.innerHTML = '<div class="cp-msg-bubble"></div>';
      messages.appendChild(msgDiv);
      var bubble = msgDiv.querySelector('.cp-msg-bubble');

      if (text.length <= 150) {
        bubble.innerHTML = formatBotOutput(text);
        scrollToBottom();
        toggleLock(false);
        return;
      }

      var charIndex = 0;
      var chunkSize = Math.max(3, Math.ceil(text.length / 45));
      var timer = setInterval(function () {
        if (charIndex < text.length) {
          charIndex = Math.min(text.length, charIndex + chunkSize);
          bubble.innerHTML = formatBotOutput(text.substring(0, charIndex));
          scrollToBottom();
        } else {
          clearInterval(timer);
          toggleLock(false);
        }
      }, 12);
    }

    function showTypingIndicator() {
      if (!enableTyping) return;
      var indicator = document.createElement('div');
      indicator.className = 'cp-widget-msg cp-msg-bot cp-js-typing-indicator';
      indicator.innerHTML = '<div class="cp-msg-bubble"><div class="cp-typing-indicator"><div class="cp-typing-dot"></div><div class="cp-typing-dot"></div><div class="cp-typing-dot"></div></div></div>';
      messages.appendChild(indicator);
      scrollToBottom();
    }

    function removeTypingIndicator() {
      var el = messages.querySelector('.cp-js-typing-indicator');
      if (el) el.remove();
    }

    function removeSuggestions() {
      var sugg = messages.querySelector('.cp-widget-suggestions');
      if (sugg) sugg.remove();
    }

    function scrollToBottom() {
      var body = container.querySelector('.cp-widget-body');
      if (body) body.scrollTop = body.scrollHeight;
    }
  }
})();
