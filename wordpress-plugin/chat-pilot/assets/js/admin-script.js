/**
 * Chat Pilot - Admin script.
 *
 * v1 shipped ~3,700 lines here because the browser drove provider testing,
 * model discovery, knowledge ingestion, form building and analytics. All of
 * that now lives in the Chat Pilot Cloud portal, so what remains is the small
 * set of actions that genuinely belong to this WordPress install: connect,
 * re-check, sync, save local settings, clear the log.
 */
(function ($) {
    'use strict';

    $(document).ready(function () {
        if (typeof chatPilotAdmin === 'undefined') {
            return;
        }

        var i18n = chatPilotAdmin.i18n || {};

        /* -------------------------------------------------- notifications -- */

        var $notification = $('#cp-notification');
        var notificationTimer = null;

        function notify(message, type) {
            if (!$notification.length) { return; }
            $notification
                .removeClass('cp-alert-success cp-alert-error cp-alert-warning')
                .addClass('cp-alert-' + (type || 'success'))
                .find('.cp-notification-text')
                .text(message);
            $notification.stop(true, true).fadeIn(150);

            clearTimeout(notificationTimer);
            notificationTimer = setTimeout(function () {
                $notification.fadeOut(200);
            }, 6000);
        }

        $notification.on('click', '.cp-notification-close', function () {
            $notification.fadeOut(150);
        });

        /* ------------------------------------------------------ reveal -- */

        /*
         * The eye button beside every key field. Fields render as type=password
         * so a key is never on screen by accident during a screen share; this
         * flips one field at a time and puts it straight back.
         */
        $(document).on('click', '.cp-eye', function () {
            var $button = $(this);
            var input = document.getElementById($button.attr('data-reveal'));
            if (!input) { return; }
            var shown = input.type === 'text';
            input.type = shown ? 'password' : 'text';
            $button
                .attr('aria-pressed', shown ? 'false' : 'true')
                .attr('aria-label', shown ? i18n.showKey || 'Show key' : i18n.hideKey || 'Hide key');
            input.focus();
        });

        /* ------------------------------------------------------- helpers -- */

        function busy($button, label) {
            $button.data('cp-label', $button.text()).prop('disabled', true).text(label);
        }

        function idle($button) {
            var label = $button.data('cp-label');
            $button.prop('disabled', false);
            if (label) { $button.text(label); }
        }

        function fail(payload, onError) {
            var message = (payload && payload.message) || i18n.genericError || 'Something went wrong.';
            if (onError) { onError(message, payload || {}); }
            else { notify(message, 'error'); }
        }

        function post(action, data, onSuccess, onError) {
            $.ajax({
                url: chatPilotAdmin.ajaxUrl,
                type: 'POST',
                dataType: 'json',
                data: $.extend({ action: action, _wpnonce: chatPilotAdmin.nonce }, data || {}),
                success: function (response) {
                    if (response && response.success) {
                        onSuccess(response.data || {});
                    } else {
                        fail(response && response.data, onError);
                    }
                },
                // wp_send_json_error() sends a 4xx status, which jQuery routes
                // here rather than to success(). The explanation the server took
                // the trouble to write lives in responseJSON.data - without this
                // every refusal, however specific, surfaced as the generic
                // "Something went wrong. Please try again."
                error: function (jqXHR) {
                    var body = jqXHR && jqXHR.responseJSON;
                    if (body && body.data && body.data.message) {
                        fail(body.data, onError);
                        return;
                    }
                    if (jqXHR && jqXHR.status === 0) {
                        fail({ message: i18n.networkError || 'Could not reach this site. Check your connection and try again.' }, onError);
                        return;
                    }
                    fail(null, onError);
                }
            });
        }

        /* ---------------------------------------------------- connection -- */

        $('#cp-connect-btn').on('click', function () {
            var $button = $(this);
            var $input = $('#cp-api-key');
            var $error = $('#cp-connect-error');
            var key = ($input.val() || '').trim();

            $error.hide().text('');

            if (!key) {
                $error.text('Paste your Chat Pilot Site API Key to continue.').show();
                $input.focus();
                return;
            }

            busy($button, i18n.connecting || 'Connecting…');

            post('chat_pilot_connect', { api_key: key }, function (data) {
                notify(data.message || i18n.connected || 'Connected', 'success');
                setTimeout(function () { window.location.reload(); }, 800);
            }, function (message) {
                $error.text(message).show();
                idle($button);
            });
        });

        // Pressing Enter in the key field should connect.
        $('#cp-api-key').on('keydown', function (event) {
            if (event.key === 'Enter') {
                event.preventDefault();
                $('#cp-connect-btn').trigger('click');
            }
        });

        // The Cloud address field is not currently rendered on the Connection
        // tab - the endpoint is set once per install in wp-config.php, so the
        // screen a client sees is just "paste your key". The handler and its
        // route stay wired for the day that field comes back; with no such
        // button on the page this binds to nothing and costs nothing.
        $('#cp-save-api-url-btn').on('click', function () {
            var $button = $(this);
            busy($button, i18n.saving || 'Saving…');

            post('chat_pilot_save_api_url', { api_url: ($('#cp-api-url').val() || '').trim() }, function (data) {
                notify(data.message || 'Saved.', 'success');
                setTimeout(function () { window.location.reload(); }, 700);
            }, function (message) {
                notify(message, 'error');
                idle($button);
            });
        });

        $('#cp-refresh-status-btn').on('click', function () {
            var $button = $(this);
            busy($button, i18n.checking || 'Checking…');

            post('chat_pilot_refresh_status', {}, function (data) {
                notify(data.message || 'Connected', 'success');
                setTimeout(function () { window.location.reload(); }, 700);
            }, function (message) {
                notify(message, 'error');
                idle($button);
                setTimeout(function () { window.location.reload(); }, 1500);
            });
        });

        $('#cp-sync-config-btn').on('click', function () {
            var $button = $(this);
            busy($button, i18n.syncing || 'Syncing…');

            post('chat_pilot_sync_config', {}, function (data) {
                notify(data.message || 'Widget configuration refreshed.', 'success');
                setTimeout(function () { window.location.reload(); }, 700);
            }, function (message) {
                notify(message, 'error');
                idle($button);
            });
        });

        $('#cp-disconnect-btn').on('click', function () {
            if (!window.confirm(i18n.confirmReset || 'Disconnect Chat Pilot from this website?')) {
                return;
            }
            var $button = $(this);
            busy($button, '…');

            post('chat_pilot_disconnect', {}, function (data) {
                notify(data.message || 'Disconnected.', 'success');
                setTimeout(function () { window.location.reload(); }, 700);
            }, function (message) {
                notify(message, 'error');
                idle($button);
            });
        });

        /* ------------------------------------------------------ settings -- */

        $('#cp-save-settings-btn').on('click', function () {
            var $button = $(this);
            var $form = $('#cp-settings-form');
            busy($button, i18n.saving || 'Saving…');

            post('chat_pilot_save_settings', {
                enable_plugin: $form.find('[name="enable_plugin"]').is(':checked') ? '1' : '',
                hide_for_admins: $form.find('[name="hide_for_admins"]').is(':checked') ? '1' : '',
                enable_logging: $form.find('[name="enable_logging"]').length
                    ? ($form.find('[name="enable_logging"]').is(':checked') ? '1' : '')
                    : '1',
                dev_mode: $form.find('[name="dev_mode"]').length
                    ? ($form.find('[name="dev_mode"]').is(':checked') ? '1' : '')
                    : '',
                display_mode: $form.find('[name="display_mode"]').val() || 'all',
                display_rules: $form.find('[name="display_rules"]').val() || ''
            }, function (data) {
                notify(data.message || 'Settings saved.', 'success');
                idle($button);
            }, function (message) {
                notify(message, 'error');
                idle($button);
            });
        });

        $('#cp-clear-log-btn').on('click', function () {
            var $button = $(this);
            busy($button, '…');

            post('chat_pilot_clear_log', {}, function (data) {
                notify(data.message || 'Log cleared.', 'success');
                setTimeout(function () { window.location.reload(); }, 600);
            }, function (message) {
                notify(message, 'error');
                idle($button);
            });
        });
    });
})(jQuery);
