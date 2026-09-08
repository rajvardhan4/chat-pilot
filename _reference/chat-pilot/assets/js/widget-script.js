/**
 * Chat Pilot - Visitor Chat Widget Script
 */
(function($) {
    'use strict';

    $(document).ready(function() {
        // Safe configuration retrieval check
        if (typeof chatPilotWidget === 'undefined') {
            return;
        }

        var $container = $('#chat-pilot-widget-container');
        var $launcher = $('#chat-pilot-widget-launcher');
        var $box = $('#chat-pilot-widget-box');
        var $closeBtn = $('#chat-pilot-widget-close');
        var $messages = $('#cp-widget-messages');
        var $inputForm = $('#cp-widget-input-form');
        var $inputField = $('#cp-widget-input-field');
        var $sendBtn = $('#cp-widget-send-btn');
        
        var isRequestActive = false;
        var conversationHistory = []; // Local state memory cache

        // Generate or retrieve session ID for visitor conversations logging
        var sessionId = localStorage.getItem('cp_session_id');
        if (!sessionId) {
            sessionId = 'cp_sess_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
            localStorage.setItem('cp_session_id', sessionId);
        }

        // 1. Restore minimized/open state preference
        var savedState = localStorage.getItem('cp_widget_state');
        if (savedState === 'open') {
            openWidget(true); // Open immediately without delay
        } else {
            // Auto open triggers if no past preference is stored
            var autoOpenChatEnabled = chatPilotWidget.autoOpenChat === '1' || chatPilotWidget.autoOpenChat === true || chatPilotWidget.autoOpenChat === 'true';
            var openOncePerVisitorEnabled = chatPilotWidget.openOncePerVisitor === '1' || chatPilotWidget.openOncePerVisitor === true || chatPilotWidget.openOncePerVisitor === 'true';
            
            if (savedState === null && autoOpenChatEnabled && chatPilotWidget.autoOpenDelay > 0) {
                var hasAutoOpened = localStorage.getItem('cp_widget_has_auto_opened');
                if (!openOncePerVisitorEnabled || hasAutoOpened !== 'yes') {
                    setTimeout(function() {
                        if (localStorage.getItem('cp_widget_state') === null) {
                            openWidget(false);
                            if (openOncePerVisitorEnabled) {
                                localStorage.setItem('cp_widget_has_auto_opened', 'yes');
                            }
                        }
                    }, chatPilotWidget.autoOpenDelay * 1000);
                }
            }
        }

        // 2. Launcher toggle action
        $launcher.on('click', function() {
            if ($box.is(':visible')) {
                closeWidget();
            } else {
                openWidget(false);
            }
        });

        $closeBtn.on('click', function(e) {
            e.stopPropagation();
            closeWidget();
        });

        function openWidget(immediate) {
            $launcher.stop(true, true).hide();
            $container.addClass('cp-widget-open');
            $box.stop(true, true).fadeIn(immediate ? 0 : 200, function() {
                scrollToBottom();
                if (!$('#cp-widget-prechat-form').is(':visible')) {
                    $inputField.focus();
                }
            });
            localStorage.setItem('cp_widget_state', 'open');
        }

        function closeWidget() {
            $box.stop(true, true).fadeOut(200, function() {
                $container.removeClass('cp-widget-open');
                $launcher.find('.cp-launcher-icon-close').hide();
                $launcher.find('.cp-launcher-icon-open').show();
                $launcher.stop(true, true).fadeIn(200);
            });
            localStorage.setItem('cp_widget_state', 'closed');
        }

        // 3. Pre-chat Form Submission logic
        $('#cp-widget-prechat-submit').on('click', function() {
            var fieldsData = {};
            var hasErrors = false;
            var errorMessages = [];
            var $errorContainer = $('.cp-prechat-error-msg');
            $errorContainer.hide().empty();

            if (!chatPilotWidget.formFields) {
                return;
            }

            $.each(chatPilotWidget.formFields, function(i, field) {
                var fid = field.id;
                var $el = $('#cp-prechat-' + fid);
                var val = '';

                if (field.type === 'checkbox') {
                    val = $el.is(':checked') ? '1' : '';
                } else if (field.type === 'radio') {
                    val = $('input[name="cp-prechat-' + fid + '"]:checked').val() || '';
                } else {
                    val = $el.val() || '';
                }

                // Required check
                if (field.required && !val.trim()) {
                    hasErrors = true;
                    errorMessages.push('The field "' + field.label + '" is required.');
                }

                // Format validation checks
                if (val.trim()) {
                    if (field.type === 'email' && !validateEmail(val)) {
                        hasErrors = true;
                        errorMessages.push('Please enter a valid email address for "' + field.label + '".');
                    }
                    if (field.type === 'phone') {
                        var digits = val.replace(/[^0-9]/g, '');
                        if (digits.length < 5) {
                            hasErrors = true;
                            errorMessages.push('Please enter a valid phone number for "' + field.label + '".');
                        }
                    }
                }

                fieldsData[fid] = val;
            });

            if (hasErrors) {
                var errHtml = '<strong>Please check the highlighted fields and try again:</strong><ul style="margin:5px 0 0 15px; padding:0; list-style:disc;">';
                $.each(errorMessages, function(idx, msg) {
                    errHtml += '<li>' + escapeHtml(msg) + '</li>';
                });
                errHtml += '</ul>';
                $errorContainer.html(errHtml).slideDown(150);
                return;
            }

            var $submitBtn = $('#cp-widget-prechat-submit');
            var originalBtnText = $submitBtn.text();
            $submitBtn.prop('disabled', true).text('Submitting...');

            $.ajax({
                url: chatPilotWidget.ajaxUrl,
                type: 'POST',
                data: {
                    action: 'chat_pilot_submit_prechat_form',
                    form_id: chatPilotWidget.formId,
                    fields: fieldsData,
                    session_id: sessionId,
                    page_url: window.location.href,
                    _wpnonce: chatPilotWidget.securityNonce
                },
                dataType: 'json',
                success: function(response) {
                    if (response.success) {
                        // Save pre-chat values to persist session skip
                        if (fieldsData.name) {
                            localStorage.setItem('cp_visitor_name', fieldsData.name);
                        }
                        if (fieldsData.email) {
                            localStorage.setItem('cp_visitor_email', fieldsData.email);
                        }
                        if (fieldsData.phone) {
                            localStorage.setItem('cp_visitor_phone', fieldsData.phone);
                        }

                        // Save submission ID
                        localStorage.setItem('cp_submission_id_' + chatPilotWidget.formId, response.data.submission_id);

                        // Transition from pre-chat panel
                        $('#cp-widget-prechat-form').fadeOut(200, function() {
                            $messages.fadeIn(200);
                            $('.cp-widget-footer').fadeIn(200);
                            scrollToBottom();
                            $inputField.focus();
                        });
                    } else {
                        $errorContainer.text(response.data.message || 'Submission failed. Please check your inputs.').slideDown(150);
                    }
                },
                error: function() {
                    $errorContainer.text('Network error occurred. Please try again.').slideDown(150);
                },
                complete: function() {
                    $submitBtn.prop('disabled', false).text(originalBtnText);
                }
            });
        });

        // Skip pre-chat form if all required fields exist in storage
        var hasRequiredCredentials = true;
        if (chatPilotWidget.hasPrechat && chatPilotWidget.formFields) {
            $.each(chatPilotWidget.formFields, function(i, field) {
                if (field.required) {
                    if (field.id === 'name' && !localStorage.getItem('cp_visitor_name')) {
                        hasRequiredCredentials = false;
                    }
                    if (field.id === 'email' && !localStorage.getItem('cp_visitor_email')) {
                        hasRequiredCredentials = false;
                    }
                    if (field.id === 'phone' && !localStorage.getItem('cp_visitor_phone')) {
                        hasRequiredCredentials = false;
                    }
                }
            });
        }

        var isPrechatRequired = chatPilotWidget.hasPrechat;

        if (isPrechatRequired && hasRequiredCredentials) {
            $('#cp-widget-prechat-form').hide();
            $messages.show();
            $('.cp-widget-footer').show();
        } else if (!isPrechatRequired) {
            $('#cp-widget-prechat-form').hide();
            $messages.show();
            $('.cp-widget-footer').show();
        } else {
            $('#cp-widget-prechat-form').show();
            $messages.hide();
            $('.cp-widget-footer').hide();
        }

        // 4. Send message handler
        $inputForm.on('submit', function(e) {
            e.preventDefault();
            if (isRequestActive) return;

            var text = $inputField.val();
            if (!text.trim()) return;

            appendUserMessage(text);
            $inputField.val('');
            
            // Lock inputs during completions API fetch
            toggleFormLock(true);
            showTypingIndicator();

            var historyPayload = compileHistory();

            $.ajax({
                url: chatPilotWidget.ajaxUrl,
                type: 'POST',
                data: {
                    action: 'chat_pilot_chat',
                    session_id: sessionId,
                    message: text,
                    history: historyPayload,
                    visitor_name: localStorage.getItem('cp_visitor_name') || '',
                    visitor_email: localStorage.getItem('cp_visitor_email') || '',
                    visitor_phone: localStorage.getItem('cp_visitor_phone') || '',
                    _wpnonce: chatPilotWidget.securityNonce
                },
                dataType: 'json',
                success: function(response) {
                    removeTypingIndicator();

                    if (response.success && response.data.text) {
                        var botResponse = response.data.text;
                        
                        if (chatPilotWidget.enableStreaming) {
                            streamResponse(botResponse);
                        } else {
                            appendBotMessage(botResponse);
                            toggleFormLock(false);
                        }
                        
                        // Push in local history state memory
                        conversationHistory.push({ role: 'user', content: text });
                        conversationHistory.push({ role: 'assistant', content: botResponse });
                    } else {
                        var errorMsg = response.data.message || "I'm having trouble responding right now. Please try again in a moment.";
                        appendBotMessage(errorMsg);
                        toggleFormLock(false);
                    }
                },
                error: function() {
                    removeTypingIndicator();
                    appendBotMessage("I'm having trouble responding right now. Please try again in a moment.");
                    toggleFormLock(false);
                }
            });
        });

        // 5. Suggested questions handler
        $container.on('click', '.cp-widget-suggest-btn', function() {
            var text = $(this).text();
            $inputField.val(text);
            $inputForm.submit();
        });

        // Helper: Toggle form locking state
        function toggleFormLock(lock) {
            isRequestActive = lock;
            $inputField.prop('disabled', lock);
            $sendBtn.prop('disabled', lock);
            if (!lock) {
                $inputField.focus();
            }
        }

        // Helper: Append User Message
        function appendUserMessage(text) {
            // Remove old suggestions on new messages
            $messages.find('.cp-widget-suggestions').remove();

            var html = '<div class="cp-widget-msg cp-msg-user">' +
                       '<div class="cp-msg-bubble">' + escapeHtml(text) + '</div>' +
                       '</div>';
            $messages.append(html);
            scrollToBottom();
        }

        // Helper: Append Bot Message
        function appendBotMessage(text) {
            var html = '<div class="cp-widget-msg cp-msg-bot">' +
                       '<div class="cp-msg-bubble">' + formatBotOutput(text) + '</div>' +
                       '</div>';
            $messages.append(html);
            scrollToBottom();
        }

        // Helper: Stream Bot Response (Fast, fluid typing animation)
        function streamResponse(text) {
            // Remove old suggestions
            $messages.find('.cp-widget-suggestions').remove();

            var $msgDiv = $('<div class="cp-widget-msg cp-msg-bot"><div class="cp-msg-bubble"></div></div>');
            $messages.append($msgDiv);
            
            var $bubble = $msgDiv.find('.cp-msg-bubble');
            
            // Render short responses or fallback messages immediately
            if (text.length <= 150) {
                $bubble.html(formatBotOutput(text));
                scrollToBottom();
                toggleFormLock(false);
                return;
            }

            var charIndex = 0;
            // Smoothly stream in chunks so the entire message renders in ~0.8s - 1.2s max
            var chunkSize = Math.max(3, Math.ceil(text.length / 45));
            var timer = setInterval(function() {
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

        // Helper: Show Typing indicator dots
        function showTypingIndicator() {
            var html = '<div class="cp-widget-msg cp-msg-bot cp-js-typing-indicator">' +
                       '<div class="cp-msg-bubble">' +
                       '<div class="cp-typing-indicator">' +
                       '<div class="cp-typing-dot"></div>' +
                       '<div class="cp-typing-dot"></div>' +
                       '<div class="cp-typing-dot"></div>' +
                       '</div>' +
                       '</div>' +
                       '</div>';
            $messages.append(html);
            scrollToBottom();
        }

        // Helper: Remove Typing indicator
        function removeTypingIndicator() {
            $messages.find('.cp-js-typing-indicator').remove();
        }

        // Helper: Scroll messages window to bottom
        function scrollToBottom() {
            $messages.scrollTop($messages[0].scrollHeight);
        }

        // Helper: Formulates conversation history array
        function compileHistory() {
            return conversationHistory;
        }

        // Helper: Basic Email validation check
        function validateEmail(email) {
            var re = /\S+@\S+\.\S+/;
            return re.test(email);
        }

        // Helper: Escape raw HTML input values
        function escapeHtml(text) {
            return text
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#039;");
        }

        // Helper: Formats Bot Outputs (support lists, paragraph linebreaks etc.)
        function formatBotOutput(text) {
            if (!text) return '';
            
            // Format basic line breaks
            var formatted = escapeHtml(text).replace(/\n/g, '<br>');
            
            // Format basic bold keywords **word** -> <strong>word</strong>
            formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
            
            // Format markdown-like bullet point listings
            formatted = formatted.replace(/(?:^|<br>)\s*-\s+(.*?)(?=<br>|$)/g, function(match, p1) {
                return '<br>• ' + p1;
            });

            // Clean leading/trailing duplicate linebreaks
            if (formatted.indexOf('<br>') === 0) {
                formatted = formatted.substring(4);
            }
            
            return formatted;
        }
    });
})(jQuery);
