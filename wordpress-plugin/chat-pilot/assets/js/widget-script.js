/**
 * Chat Pilot - Visitor Chat Widget Script
 *
 * Behaviour is unchanged from v1: same launcher, same open/close, same auto-open
 * rules, same pre-chat flow, same typing indicator and streaming animation.
 *
 * The only substantive change is where answers come from. The browser posts to
 * admin-ajax.php, which proxies to Chat Pilot Cloud server-side. The Site API
 * Key is never present in this file, in the page, or in any request the browser
 * can see, and conversation history is no longer sent from the client - the
 * server owns it, so a visitor cannot forge or replay a conversation.
 */
(function ($) {
    'use strict';

    $(document).ready(function () {
        if (typeof chatPilotWidget === 'undefined') {
            return;
        }

        var $container = $('#chat-pilot-widget-container');
        var $launcher = $('#chat-pilot-widget-launcher');
        var $box = $('#chat-pilot-widget-box');
        var $closeBtn = $('#chat-pilot-widget-close');
        var $callout = $('#chat-pilot-launcher-callout');
        var $calloutClose = $('#chat-pilot-callout-close');
        var $messages = $('#cp-widget-messages');
        var $inputForm = $('#cp-widget-input-form');
        var $inputField = $('#cp-widget-input-field');
        var $sendBtn = $('#cp-widget-send-btn');

        var isRequestActive = false;

        var FALLBACK_ERROR = chatPilotWidget.errorMessage ||
            "I'm having trouble responding right now. Please try again in a moment.";

        /* ------------------------------------------------------- storage -- */

        // Private browsing and locked-down browsers can throw on storage access,
        // so every read and write is guarded. The widget must never break a page.
        function storageGet(key) {
            try {
                return window.localStorage.getItem(key);
            } catch (err) {
                return null;
            }
        }

        function storageSet(key, value) {
            try {
                window.localStorage.setItem(key, value);
            } catch (err) {
                /* storage unavailable; the widget still works for this visit */
            }
        }

        var sessionId = storageGet('cp_session_id');
        if (!sessionId || sessionId.length < 12) {
            sessionId = 'cp_sess_' + Math.random().toString(36).substring(2, 15) +
                Math.random().toString(36).substring(2, 15);
            storageSet('cp_session_id', sessionId);
        }

        /* ---------------------------------------------------- callout badge -- */

        if ($callout.length) {
            if (storageGet('cp_callout_dismissed') === 'yes') {
                $callout.hide();
            }

            $callout.on('click', function (e) {
                if ($(e.target).closest('#chat-pilot-callout-close').length) {
                    return;
                }
                openWidget(false);
            });

            $calloutClose.on('click', function (e) {
                e.stopPropagation();
                $callout.stop(true, true).fadeOut(200);
                storageSet('cp_callout_dismissed', 'yes');
            });
        }

        /* ---------------------------------------------------- open state -- */

        var savedState = storageGet('cp_widget_state');
        if (savedState === 'open') {
            openWidget(true);
        } else {
            var autoOpen = chatPilotWidget.autoOpenChat === true ||
                chatPilotWidget.autoOpenChat === '1' || chatPilotWidget.autoOpenChat === 'true';
            var openOnce = chatPilotWidget.openOncePerVisitor === true ||
                chatPilotWidget.openOncePerVisitor === '1' || chatPilotWidget.openOncePerVisitor === 'true';

            if (savedState === null && autoOpen && chatPilotWidget.autoOpenDelay > 0) {
                var hasAutoOpened = storageGet('cp_widget_has_auto_opened');
                if (!openOnce || hasAutoOpened !== 'yes') {
                    setTimeout(function () {
                        if (storageGet('cp_widget_state') === null) {
                            openWidget(false);
                            if (openOnce) {
                                storageSet('cp_widget_has_auto_opened', 'yes');
                            }
                        }
                    }, chatPilotWidget.autoOpenDelay * 1000);
                }
            }
        }

        $launcher.on('click', function () {
            if ($box.is(':visible')) {
                closeWidget();
            } else {
                openWidget(false);
            }
        });

        $closeBtn.on('click', function (e) {
            e.stopPropagation();
            closeWidget();
        });

        function openWidget(immediate) {
            if ($callout.length) {
                $callout.stop(true, true).hide();
            }
            $launcher.stop(true, true).hide();
            $container.addClass('cp-widget-open');
            $box.stop(true, true).fadeIn(immediate ? 0 : 200, function () {
                scrollToBottom();
                if (!$('#cp-widget-prechat-form').is(':visible')) {
                    $inputField.focus();
                }
            });
            storageSet('cp_widget_state', 'open');
        }

        function closeWidget() {
            $box.stop(true, true).fadeOut(200, function () {
                $container.removeClass('cp-widget-open');
                $launcher.find('.cp-launcher-icon-close').hide();
                $launcher.find('.cp-launcher-icon-open').show();
                $launcher.stop(true, true).fadeIn(200);
                if ($callout.length && storageGet('cp_callout_dismissed') !== 'yes') {
                    $callout.stop(true, true).fadeIn(300);
                }
            });
            storageSet('cp_widget_state', 'closed');
        }

        /* --------------------------------------------------- pre-chat -- */

        $('#cp-widget-prechat-submit').on('click', function () {
            var fieldsData = {};
            var errorMessages = [];
            var $errorContainer = $('.cp-prechat-error-msg');
            $errorContainer.hide().empty();

            if (!chatPilotWidget.formFields) {
                return;
            }

            var $fields = $('.cp-prechat-input-field');
            if ($fields.length > 0) {
                $fields.each(function () {
                    var $el = $(this);
                    var fid = ($el.attr('id') || '').replace('cp-prechat-', '');
                    var isReq = $el.prop('required');
                    var val = '';

                    if ($el.is(':checkbox')) {
                        val = $el.is(':checked') ? '1' : '';
                    } else if ($el.is(':radio')) {
                        var rname = $el.attr('name');
                        val = $('input[name="' + rname + '"]:checked').val() || '';
                    } else {
                        val = $.trim($el.val());
                    }

                    if (fid) {
                        fieldsData[fid] = val;
                    }

                    var labelText = $('label[for="' + $el.attr('id') + '"]').text().replace('*', '').trim() || fid;
                    if (isReq && !val) {
                        errorMessages.push('The field "' + labelText + '" is required.');
                    } else if (val) {
                        if ($el.attr('type') === 'email' && !validateEmail(val)) {
                            errorMessages.push('Please enter a valid email address for "' + labelText + '".');
                        }
                        if ($el.attr('type') === 'phone' && val.replace(/[^0-9]/g, '').length < 5) {
                            errorMessages.push('Please enter a valid phone number for "' + labelText + '".');
                        }
                    }
                });
            } else if (chatPilotWidget.formFields) {
                $.each(chatPilotWidget.formFields, function (i, field) {
                    var fid = field.id;
                    var $el = $('#cp-prechat-' + fid);
                    var val = '';

                    if (field.type === 'checkbox') {
                        val = $el.is(':checked') ? '1' : '';
                    } else if (field.type === 'radio') {
                        val = $('input[name="cp-prechat-' + fid + '"]:checked').val() || '';
                    } else {
                        val = $.trim($el.val());
                    }

                    if (field.required && !val) {
                        errorMessages.push('The field "' + field.label + '" is required.');
                    }
                    if (val) {
                        if (field.type === 'email' && !validateEmail(val)) {
                            errorMessages.push('Please enter a valid email address for "' + field.label + '".');
                        }
                        if (field.type === 'phone' && val.replace(/[^0-9]/g, '').length < 5) {
                            errorMessages.push('Please enter a valid phone number for "' + field.label + '".');
                        }
                    }
                    fieldsData[fid] = val;
                });
            }

            if (errorMessages.length) {
                showPrechatErrors(errorMessages);
                return;
            }

            var $submitBtn = $(this);
            var originalBtnText = $submitBtn.text();
            var activeFormId = chatPilotWidget.formId || $('#cp-widget-prechat-form').attr('data-form-id') || '';
            $submitBtn.prop('disabled', true).text('Submitting...');

            $.ajax({
                url: chatPilotWidget.ajaxUrl,
                type: 'POST',
                data: {
                    action: 'chat_pilot_submit_prechat_form',
                    form_id: activeFormId,
                    fields: fieldsData,
                    session_id: sessionId,
                    page_url: window.location.href,
                    _wpnonce: chatPilotWidget.securityNonce
                },
                dataType: 'json',
                success: function (response) {
                    if (response && response.success) {
                        if (fieldsData.name) { storageSet('cp_visitor_name', fieldsData.name); }
                        if (fieldsData.email) { storageSet('cp_visitor_email', fieldsData.email); }
                        if (fieldsData.phone) { storageSet('cp_visitor_phone', fieldsData.phone); }
                        if (activeFormId) { storageSet('cp_prechat_done_' + activeFormId, 'yes'); }

                        $('#cp-widget-prechat-form').fadeOut(200, function () {
                            $messages.fadeIn(200);
                            $('.cp-widget-footer').fadeIn(200);
                            scrollToBottom();
                            $inputField.focus();
                        });
                    } else {
                        var data = (response && response.data) || {};
                        var messages = [];
                        if (data.fields) {
                            $.each(data.fields, function (key, value) { messages.push(value); });
                        }
                        if (!messages.length) {
                            messages.push(data.message || 'Submission failed. Please check your details.');
                        }
                        showPrechatErrors(messages);
                    }
                },
                error: function () {
                    showPrechatErrors(['We could not start the chat just now. Please try again in a moment.']);
                },
                complete: function () {
                    $submitBtn.prop('disabled', false).text(originalBtnText);
                }
            });
        });

        function showPrechatErrors(messages) {
            var $errorContainer = $('.cp-prechat-error-msg');
            var html = '<strong>Please check the highlighted fields and try again:</strong>' +
                '<ul style="margin:5px 0 0 15px; padding:0; list-style:disc;">';
            $.each(messages, function (i, msg) {
                html += '<li>' + escapeHtml(msg) + '</li>';
            });
            html += '</ul>';
            $errorContainer.html(html).slideDown(150);
        }

        // --- Pre-Chat Visibility & Live Config Synchronization ---
        function updatePrechatVisibility(hasPrechat, formId) {
            var activeFormId = formId || chatPilotWidget.formId || $('#cp-widget-prechat-form').attr('data-form-id') || '';
            var isCompleted = activeFormId && storageGet('cp_prechat_done_' + activeFormId) === 'yes';

            if (hasPrechat && !isCompleted && $('#cp-widget-prechat-form').length > 0) {
                $('#cp-widget-prechat-form').show();
                $messages.hide();
                $('.cp-widget-footer').hide();
            } else {
                $('#cp-widget-prechat-form').hide();
                $messages.show();
                $('.cp-widget-footer').show();
            }
        }

        // Initial setup from inline localized data
        updatePrechatVisibility(Boolean(chatPilotWidget.hasPrechat), chatPilotWidget.formId);

        // Dynamic synchronization via admin-ajax.php (bypasses LiteSpeed & page caches completely)
        if (chatPilotWidget.ajaxUrl) {
            $.ajax({
                url: chatPilotWidget.ajaxUrl,
                type: 'GET',
                data: { action: 'chat_pilot_get_config' },
                dataType: 'json',
                success: function (res) {
                    if (res && res.success && res.data) {
                        var live = res.data;
                        if (live.formId) {
                            chatPilotWidget.formId = live.formId;
                            $('#cp-widget-prechat-form').attr('data-form-id', live.formId);
                        }
                        if (typeof live.hasPrechat !== 'undefined') {
                            chatPilotWidget.hasPrechat = live.hasPrechat ? '1' : '';
                        }
                        // If prechat is enabled but the form markup was missing in a cached page, dynamically build it!
                        if (live.hasPrechat && $('#cp-widget-prechat-form').length === 0 && live.fields && live.fields.length > 0) {
                            var formHtml = '<div id="cp-widget-prechat-form" data-form-id="' + escapeHtml(live.formId || '') + '">';
                            formHtml += '<p class="cp-widget-prechat-intro">' + escapeHtml(live.intro || 'Please introduce yourself to start the conversation.') + '</p>';
                            formHtml += '<div class="cp-prechat-error-msg" style="display:none; color:#ef4444; font-size:0.85rem; margin-bottom:0.75rem; border:1px solid rgba(239,68,68,0.15); background:rgba(239,68,68,0.05); padding:0.5rem 0.75rem; border-radius:6px; line-height:1.4;"></div>';
                            $.each(live.fields, function (i, f) {
                                var fid = escapeHtml(f.key || f.id || '');
                                var ftype = f.type || 'text';
                                var label = escapeHtml(f.label || '');
                                var placeholder = escapeHtml(f.placeholder || '');
                                var req = Boolean(f.required);
                                var reqStar = req ? ' <span class="cp-required-star" style="color:#ef4444;">*</span>' : '';
                                var reqAttr = req ? 'required' : '';
                                if (!fid) return;
                                formHtml += '<div class="cp-widget-form-group" style="margin-bottom:0.75rem;">';
                                formHtml += '<label for="cp-prechat-' + fid + '" style="display:block; font-size:0.85rem; font-weight:600; margin-bottom:0.25rem;">' + label + reqStar + '</label>';
                                formHtml += '<input type="' + (ftype === 'email' ? 'email' : 'text') + '" id="cp-prechat-' + fid + '" class="cp-widget-input cp-prechat-input-field" placeholder="' + placeholder + '" ' + reqAttr + ' style="width:100%; border-radius:6px; padding:0.5rem 0.75rem; height:38px; background:rgba(255,255,255,0.05); color:#ffffff; border:1px solid rgba(255,255,255,0.1);">';
                                formHtml += '</div>';
                            });
                            formHtml += '<button id="cp-widget-prechat-submit" class="cp-widget-btn">Start Chat</button>';
                            formHtml += '</div>';
                            $('.cp-widget-body').prepend(formHtml);
                        }
                        updatePrechatVisibility(Boolean(live.hasPrechat), live.formId);
                    }
                }
            });
        }

        /* ------------------------------------------------------ sending -- */

        // Enter must send. Implicit form submission varies across browsers and
        // embeddings, and this is the visitor's primary interaction, so it is
        // wired explicitly rather than assumed.
        $inputField.on('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                $inputForm.trigger('submit');
            }
        });

        $inputForm.on('submit', function (e) {
            e.preventDefault();
            if (isRequestActive) { return; }

            var text = $inputField.val();
            if (!text || !text.trim()) { return; }

            appendUserMessage(text);
            $inputField.val('');
            toggleFormLock(true);
            showTypingIndicator();

            $.ajax({
                url: chatPilotWidget.ajaxUrl,
                type: 'POST',
                data: {
                    action: 'chat_pilot_chat',
                    session_id: sessionId,
                    message: text,
                    page_url: window.location.href,
                    visitor_name: storageGet('cp_visitor_name') || '',
                    visitor_email: storageGet('cp_visitor_email') || '',
                    visitor_phone: storageGet('cp_visitor_phone') || '',
                    _wpnonce: chatPilotWidget.securityNonce
                },
                dataType: 'json',
                success: function (response) {
                    removeTypingIndicator();

                    if (response && response.success && response.data && response.data.text) {
                        if (chatPilotWidget.enableStreaming) {
                            streamResponse(response.data.text);
                        } else {
                            appendBotMessage(response.data.text);
                            toggleFormLock(false);
                        }
                    } else {
                        var message = (response && response.data && response.data.message) || FALLBACK_ERROR;
                        appendBotMessage(message);
                        toggleFormLock(false);
                    }
                },
                error: function () {
                    removeTypingIndicator();
                    appendBotMessage(FALLBACK_ERROR);
                    toggleFormLock(false);
                }
            });
        });

        $container.on('click', '.cp-widget-suggest-btn', function () {
            $inputField.val($(this).text());
            $inputForm.submit();
        });

        /* ------------------------------------------------------ helpers -- */

        function toggleFormLock(lock) {
            isRequestActive = lock;
            $inputField.prop('disabled', lock);
            $sendBtn.prop('disabled', lock);
            if (!lock) { $inputField.focus(); }
        }

        function appendUserMessage(text) {
            $messages.find('.cp-widget-suggestions').remove();
            $messages.append(
                '<div class="cp-widget-msg cp-msg-user"><div class="cp-msg-bubble">' +
                escapeHtml(text) + '</div></div>'
            );
            scrollToBottom();
        }

        function appendBotMessage(text) {
            $messages.append(
                '<div class="cp-widget-msg cp-msg-bot"><div class="cp-msg-bubble">' +
                formatBotOutput(text) + '</div></div>'
            );
            scrollToBottom();
        }

        function streamResponse(text) {
            $messages.find('.cp-widget-suggestions').remove();

            var $msgDiv = $('<div class="cp-widget-msg cp-msg-bot"><div class="cp-msg-bubble"></div></div>');
            $messages.append($msgDiv);
            var $bubble = $msgDiv.find('.cp-msg-bubble');

            if (text.length <= 150) {
                $bubble.html(formatBotOutput(text));
                scrollToBottom();
                toggleFormLock(false);
                return;
            }

            var charIndex = 0;
            var chunkSize = Math.max(3, Math.ceil(text.length / 45));
            var timer = setInterval(function () {
                if (charIndex < text.length) {
                    charIndex = Math.min(text.length, charIndex + chunkSize);
                    $bubble.html(formatBotOutput(text.substring(0, charIndex)));
                    scrollToBottom();
                } else {
                    clearInterval(timer);
                    toggleFormLock(false);
                }
            }, 12);
        }

        function showTypingIndicator() {
            if (!chatPilotWidget.enableTyping) { return; }
            $messages.append(
                '<div class="cp-widget-msg cp-msg-bot cp-js-typing-indicator">' +
                '<div class="cp-msg-bubble"><div class="cp-typing-indicator">' +
                '<div class="cp-typing-dot"></div><div class="cp-typing-dot"></div><div class="cp-typing-dot"></div>' +
                '</div></div></div>'
            );
            scrollToBottom();
        }

        function removeTypingIndicator() {
            $messages.find('.cp-js-typing-indicator').remove();
        }

        function scrollToBottom() {
            if ($messages.length && $messages[0]) {
                $messages.scrollTop($messages[0].scrollHeight);
            }
        }

        function validateEmail(email) {
            return /\S+@\S+\.\S+/.test(email);
        }

        function escapeHtml(text) {
            return String(text === null || text === undefined ? '' : text)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        }

        /**
         * Renders the answer. Everything is escaped first, then a small, closed
         * set of formatting is re-introduced. Nothing from the server is ever
         * inserted as raw HTML.
         */
        function formatBotOutput(text) {
            if (!text) { return ''; }

            var formatted = escapeHtml(text);

            // Format action buttons [action:Label](url)
            formatted = formatted.replace(/\[action:([^\]]+)\]\((https?:\/\/[^\s\)]+)\)/gi, function(_, label, url) {
                return '<a href="' + url + '" target="_blank" rel="noopener noreferrer" class="cp-action-btn" style="display:inline-block; margin:6px 0; padding:6px 14px; background:#2563eb; color:#fff !important; font-weight:600; font-size:13px; border-radius:6px; text-decoration:none !important; box-shadow:0 1px 3px rgba(0,0,0,0.2);">' + label + ' &nearr;</a>';
            });

            // Format regular markdown links [Label](url)
            formatted = formatted.replace(/\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)/gi, function(_, label, url) {
                return '<a href="' + url + '" target="_blank" rel="noopener noreferrer" style="color:#0284c7 !important; text-decoration:underline !important; font-weight:600;">' + label + ' &nearr;</a>';
            });

            formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
            formatted = formatted.replace(/(?:^|\n)\s*-\s+(.*?)(?=\n|$)/g, '<br>&bull; $1');
            formatted = formatted.replace(/\n/g, '<br>');

            if (formatted.indexOf('<br>') === 0) {
                formatted = formatted.substring(4);
            }
            return formatted;
        }
    });
})(jQuery);
