<?php
namespace ChatPilot\Notifications;

// Prevent direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class NotificationManager
 * Manages email notification triggers for leads, new conversations, and AI budget threshold alerts.
 */
class NotificationManager {

	/**
	 * Sends an email notification safely with error handling and DB logging.
	 *
	 * @param string $to      Recipient email address.
	 * @param string $subject Notification subject line.
	 * @param string $body    HTML content body.
	 * @param array  $context Event context metadata.
	 * @return bool True if mail sent successfully, false on failure.
	 */
	public function send_notification( $to, $subject, $body, array $context = array() ) {
		$plugin   = \ChatPilot\Core\Plugin::instance();
		$settings = $plugin->settings;

		$enable_admin = $settings->get( 'notifications.enable_admin_notifications', true );
		if ( ! $enable_admin ) {
			\ChatPilot\Common\Logger::log( 'info', 'Notification skipped: Admin notifications are disabled in settings.', $context );
			return false;
		}

		if ( empty( $to ) || ! is_email( $to ) ) {
			$to = $settings->get( 'notifications.notification_email', get_option( 'admin_email', '' ) );
		}

		if ( empty( $to ) || ! is_email( $to ) ) {
			\ChatPilot\Common\Logger::log( 'error', 'Notification Failed: No valid recipient email address configured.', $context );
			return false;
		}

		$site_name   = get_bloginfo( 'name' );
		$admin_email = get_option( 'admin_email' );

		$headers = array(
			'Content-Type: text/html; charset=UTF-8',
			sprintf( 'From: %s <%s>', esc_html( $site_name ), esc_html( $admin_email ) ),
		);

		// Capture wp_mail errors via action hook
		$mail_error     = '';
		$error_callback = function( $wp_error ) use ( &$mail_error ) {
			if ( is_wp_error( $wp_error ) ) {
				$mail_error = $wp_error->get_error_message();
			}
		};
		add_action( 'wp_mail_failed', $error_callback );

		try {
			$sent = wp_mail( $to, $subject, $body, $headers );
		} catch ( \Throwable $e ) {
			$sent       = false;
			$mail_error = $e->getMessage();
		}

		remove_action( 'wp_mail_failed', $error_callback );

		if ( $sent ) {
			\ChatPilot\Common\Logger::log(
				'info',
				sprintf( 'Notification Sent: "%s" to %s', $subject, $to ),
				array_merge( $context, array( 'recipient' => $to, 'subject' => $subject, 'status' => 'sent' ) )
			);
			return true;
		}

		if ( empty( $mail_error ) ) {
			global $phpmailer;
			if ( isset( $phpmailer->ErrorInfo ) && ! empty( $phpmailer->ErrorInfo ) ) {
				$mail_error = $phpmailer->ErrorInfo;
			} else {
				$mail_error = 'wp_mail() returned false (server mail transport rejected or unconfigured).';
			}
		}

		\ChatPilot\Common\Logger::log(
			'error',
			sprintf( 'Notification Failed: "%s" to %s - Error: %s', $subject, $to, $mail_error ),
			array_merge( $context, array( 'recipient' => $to, 'subject' => $subject, 'status' => 'failed', 'error' => $mail_error ) )
		);

		return false;
	}

	/**
	 * Triggers email notification when a new lead is captured.
	 *
	 * @param int   $submission_id Lead submission ID.
	 * @param array $submission    Lead submission data array.
	 * @return bool Success status.
	 */
	public function trigger_lead_notification( $submission_id, array $submission ) {
		$plugin   = \ChatPilot\Core\Plugin::instance();
		$settings = $plugin->settings;

		if ( ! $settings->get( 'notifications.notify_on_lead', true ) ) {
			return false;
		}

		$recipient = $settings->get( 'notifications.notification_email', get_option( 'admin_email', '' ) );
		$site_name = get_bloginfo( 'name' );
		$subject   = sprintf( '[%s Lead] New Lead Captured: %s', $site_name, ! empty( $submission['name'] ) ? $submission['name'] : ( ! empty( $submission['email'] ) ? $submission['email'] : '#' . $submission_id ) );

		$fields_html = '';
		if ( ! empty( $submission['custom_fields'] ) && is_array( $submission['custom_fields'] ) ) {
			foreach ( $submission['custom_fields'] as $k => $v ) {
				if ( in_array( strtolower( $k ), array( 'name', 'email', 'phone', 'session_id', 'page_url', 'form_id', 'custom_fields' ), true ) ) {
					continue;
				}
				$label = ucwords( str_replace( '_', ' ', $k ) );
				$val   = is_array( $v ) ? implode( ', ', $v ) : $v;
				$fields_html .= sprintf( '<tr><td style="padding: 8px; font-weight: bold; color: #475569; border-bottom: 1px solid #e2e8f0;">%s:</td><td style="padding: 8px; color: #1e293b; border-bottom: 1px solid #e2e8f0;">%s</td></tr>', esc_html( $label ), esc_html( $val ) );
			}
		}

		$body = sprintf(
			'<!DOCTYPE html><html><body style="font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px;">' .
			'<div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">' .
			'<div style="background: linear-gradient(135deg, #0f172a 0%%, #1e293b 100%%); padding: 20px 24px; color: #ffffff;">' .
			'<h2 style="margin: 0; font-size: 20px; font-weight: 600;">🎯 New Lead Captured!</h2>' .
			'<p style="margin: 4px 0 0 0; color: #94a3b8; font-size: 14px;">Chat Pilot Notification</p>' .
			'</div>' .
			'<div style="padding: 24px;">' .
			'<table style="width: 100%%; border-collapse: collapse; margin-bottom: 20px;">' .
			'<tr><td style="padding: 8px; font-weight: bold; color: #475569; border-bottom: 1px solid #e2e8f0; width: 140px;">Lead ID:</td><td style="padding: 8px; color: #1e293b; border-bottom: 1px solid #e2e8f0;">#%d</td></tr>' .
			'<tr><td style="padding: 8px; font-weight: bold; color: #475569; border-bottom: 1px solid #e2e8f0;">Name:</td><td style="padding: 8px; color: #1e293b; border-bottom: 1px solid #e2e8f0;">%s</td></tr>' .
			'<tr><td style="padding: 8px; font-weight: bold; color: #475569; border-bottom: 1px solid #e2e8f0;">Email:</td><td style="padding: 8px; color: #1e293b; border-bottom: 1px solid #e2e8f0;"><a href="mailto:%s" style="color: #2563eb; text-decoration: none;">%s</a></td></tr>' .
			'<tr><td style="padding: 8px; font-weight: bold; color: #475569; border-bottom: 1px solid #e2e8f0;">Phone:</td><td style="padding: 8px; color: #1e293b; border-bottom: 1px solid #e2e8f0;">%s</td></tr>' .
			'%s' .
			'<tr><td style="padding: 8px; font-weight: bold; color: #475569; border-bottom: 1px solid #e2e8f0;">Session ID:</td><td style="padding: 8px; color: #64748b; font-family: monospace; font-size: 13px; border-bottom: 1px solid #e2e8f0;">%s</td></tr>' .
			'<tr><td style="padding: 8px; font-weight: bold; color: #475569;">Submitted At:</td><td style="padding: 8px; color: #1e293b;">%s</td></tr>' .
			'</table>' .
			'</div>' .
			'<div style="background: #f1f5f9; padding: 12px 24px; text-align: center; font-size: 12px; color: #64748b;">' .
			'Automated Notification generated by Chat Pilot on %s' .
			'</div>' .
			'</div></body></html>',
			intval( $submission_id ),
			esc_html( ! empty( $submission['name'] ) ? $submission['name'] : 'N/A' ),
			esc_attr( ! empty( $submission['email'] ) ? $submission['email'] : '' ),
			esc_html( ! empty( $submission['email'] ) ? $submission['email'] : 'N/A' ),
			esc_html( ! empty( $submission['phone'] ) ? $submission['phone'] : 'N/A' ),
			$fields_html,
			esc_html( ! empty( $submission['session_id'] ) ? $submission['session_id'] : 'N/A' ),
			esc_html( current_time( 'mysql' ) ),
			esc_html( $site_name )
		);

		return $this->send_notification( $recipient, $subject, $body, array( 'submission_id' => $submission_id, 'event' => 'new_lead' ) );
	}

	/**
	 * Triggers email notification when a new conversation starts.
	 *
	 * @param int   $conversation_id Conversation ID.
	 * @param array $conv_data       Conversation metadata.
	 * @return bool Success status.
	 */
	public function trigger_conversation_notification( $conversation_id, array $conv_data ) {
		$plugin   = \ChatPilot\Core\Plugin::instance();
		$settings = $plugin->settings;

		if ( ! $settings->get( 'notifications.notify_on_conversation', false ) ) {
			return false;
		}

		$recipient = $settings->get( 'notifications.notification_email', get_option( 'admin_email', '' ) );
		$site_name = get_bloginfo( 'name' );
		$subject   = sprintf( '[%s Chat] New Visitor Conversation Started #%d', $site_name, intval( $conversation_id ) );

		$body = sprintf(
			'<!DOCTYPE html><html><body style="font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px;">' .
			'<div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">' .
			'<div style="background: linear-gradient(135deg, #0f172a 0%%, #1e293b 100%%); padding: 20px 24px; color: #ffffff;">' .
			'<h2 style="margin: 0; font-size: 20px; font-weight: 600;">💬 New Visitor Conversation Started</h2>' .
			'<p style="margin: 4px 0 0 0; color: #94a3b8; font-size: 14px;">Chat Pilot Notification</p>' .
			'</div>' .
			'<div style="padding: 24px;">' .
			'<p style="color: #334155; margin-top: 0;">A new conversation was initiated on <strong>%s</strong>.</p>' .
			'<table style="width: 100%%; border-collapse: collapse; margin-bottom: 20px;">' .
			'<tr><td style="padding: 8px; font-weight: bold; color: #475569; border-bottom: 1px solid #e2e8f0; width: 140px;">Conversation ID:</td><td style="padding: 8px; color: #1e293b; border-bottom: 1px solid #e2e8f0;">#%d</td></tr>' .
			'<tr><td style="padding: 8px; font-weight: bold; color: #475569; border-bottom: 1px solid #e2e8f0;">Session ID:</td><td style="padding: 8px; color: #64748b; font-family: monospace; font-size: 13px; border-bottom: 1px solid #e2e8f0;">%s</td></tr>' .
			'<tr><td style="padding: 8px; font-weight: bold; color: #475569; border-bottom: 1px solid #e2e8f0;">Visitor:</td><td style="padding: 8px; color: #1e293b; border-bottom: 1px solid #e2e8f0;">%s (%s)</td></tr>' .
			'<tr><td style="padding: 8px; font-weight: bold; color: #475569; border-bottom: 1px solid #e2e8f0;">First Message:</td><td style="padding: 8px; color: #1e293b; border-bottom: 1px solid #e2e8f0;"><em>"%s"</em></td></tr>' .
			'</table>' .
			'<div style="text-align: center; margin-top: 24px;">' .
			'<a href="%s" style="display: inline-block; background: #2563eb; color: #ffffff; text-decoration: none; padding: 10px 20px; border-radius: 6px; font-weight: 600; font-size: 14px;">View Conversation in Admin</a>' .
			'</div>' .
			'</div>' .
			'<div style="background: #f1f5f9; padding: 12px 24px; text-align: center; font-size: 12px; color: #64748b;">' .
			'Automated Notification generated by Chat Pilot on %s' .
			'</div>' .
			'</div></body></html>',
			esc_html( $site_name ),
			intval( $conversation_id ),
			esc_html( ! empty( $conv_data['session_id'] ) ? $conv_data['session_id'] : 'N/A' ),
			esc_html( ! empty( $conv_data['visitor_name'] ) ? $conv_data['visitor_name'] : 'Guest Visitor' ),
			esc_html( ! empty( $conv_data['visitor_email'] ) ? $conv_data['visitor_email'] : 'No email provided' ),
			esc_html( ! empty( $conv_data['first_message'] ) ? $conv_data['first_message'] : '' ),
			admin_url( 'admin.php?page=chat-pilot-conversations' ),
			esc_html( $site_name )
		);

		return $this->send_notification( $recipient, $subject, $body, array( 'conversation_id' => $conversation_id, 'event' => 'new_conversation' ) );
	}

	/**
	 * Triggers email notification when AI budget limit warning threshold is reached.
	 *
	 * @param array $budget_info Details regarding cost/token limits.
	 * @return bool Success status.
	 */
	public function trigger_budget_warning_notification( array $budget_info ) {
		$plugin   = \ChatPilot\Core\Plugin::instance();
		$settings = $plugin->settings;

		if ( ! $settings->get( 'notifications.notify_on_budget_warning', true ) ) {
			return false;
		}

		$recipient = $settings->get( 'notifications.notification_email', get_option( 'admin_email', '' ) );
		$site_name = get_bloginfo( 'name' );
		$subject   = sprintf( '[⚠️ %s Warning] AI Token/Budget Limit Warning Threshold Reached', $site_name );

		$body = sprintf(
			'<!DOCTYPE html><html><body style="font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px;">' .
			'<div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #cbd5e1; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">' .
			'<div style="background: linear-gradient(135deg, #b91c1c 0%%, #991b1b 100%%); padding: 20px 24px; color: #ffffff;">' .
			'<h2 style="margin: 0; font-size: 20px; font-weight: 600;">⚠️ AI Budget Warning Threshold Reached</h2>' .
			'<p style="margin: 4px 0 0 0; color: #fca5a5; font-size: 14px;">Chat Pilot Cost Protection Alert</p>' .
			'</div>' .
			'<div style="padding: 24px;">' .
			'<p style="color: #334155; margin-top: 0;">Your Chat Pilot AI usage has reached or exceeded your configured warning threshold on <strong>%s</strong>.</p>' .
			'<table style="width: 100%%; border-collapse: collapse; margin-bottom: 20px;">' .
			'<tr><td style="padding: 8px; font-weight: bold; color: #475569; border-bottom: 1px solid #e2e8f0; width: 160px;">Provider / Model:</td><td style="padding: 8px; color: #1e293b; border-bottom: 1px solid #e2e8f0;">%s / %s</td></tr>' .
			'<tr><td style="padding: 8px; font-weight: bold; color: #475569; border-bottom: 1px solid #e2e8f0;">Current Token Usage:</td><td style="padding: 8px; color: #dc2626; font-weight: bold; border-bottom: 1px solid #e2e8f0;">%s Tokens</td></tr>' .
			'<tr><td style="padding: 8px; font-weight: bold; color: #475569; border-bottom: 1px solid #e2e8f0;">Configured Cap Limit:</td><td style="padding: 8px; color: #1e293b; border-bottom: 1px solid #e2e8f0;">%s Tokens</td></tr>' .
			'<tr><td style="padding: 8px; font-weight: bold; color: #475569;">Triggered At:</td><td style="padding: 8px; color: #1e293b;">%s</td></tr>' .
			'</table>' .
			'<div style="text-align: center; margin-top: 24px;">' .
			'<a href="%s" style="display: inline-block; background: #dc2626; color: #ffffff; text-decoration: none; padding: 10px 20px; border-radius: 6px; font-weight: 600; font-size: 14px;">Manage Budget Settings</a>' .
			'</div>' .
			'</div>' .
			'<div style="background: #f1f5f9; padding: 12px 24px; text-align: center; font-size: 12px; color: #64748b;">' .
			'Automated Budget Alert generated by Chat Pilot on %s' .
			'</div>' .
			'</div></body></html>',
			esc_html( $site_name ),
			esc_html( ! empty( $budget_info['provider'] ) ? $budget_info['provider'] : 'All' ),
			esc_html( ! empty( $budget_info['model'] ) ? $budget_info['model'] : 'All' ),
			esc_html( number_format( isset( $budget_info['current_tokens'] ) ? $budget_info['current_tokens'] : 0 ) ),
			esc_html( number_format( isset( $budget_info['limit_tokens'] ) ? $budget_info['limit_tokens'] : 0 ) ),
			esc_html( current_time( 'mysql' ) ),
			admin_url( 'admin.php?page=chat-pilot-settings' ),
			esc_html( $site_name )
		);

		return $this->send_notification( $recipient, $subject, $body, array( 'event' => 'budget_warning', 'info' => $budget_info ) );
	}

	/**
	 * Triggers email notification when an AI provider quota or generation failure occurs.
	 * Implements intelligent throttling to suppress repetitive duplicate alerts.
	 *
	 * @param array $failure_info Error details (provider, model, error_type, error_label, message, timestamp).
	 * @return bool True if notification was sent, false if throttled, disabled, or failed.
	 */
	public function trigger_provider_failure_notification( array $failure_info ) {
		$plugin   = \ChatPilot\Core\Plugin::instance();
		$settings = $plugin->settings;

		$provider_slug = ! empty( $failure_info['provider'] ) ? sanitize_key( $failure_info['provider'] ) : 'unknown';
		$error_type    = ! empty( $failure_info['status'] ) ? sanitize_key( $failure_info['status'] ) : ( ! empty( $failure_info['error_type'] ) ? sanitize_key( $failure_info['error_type'] ) : 'provider_error' );
		$error_label   = ! empty( $failure_info['label'] ) ? sanitize_text_field( $failure_info['label'] ) : ( ! empty( $failure_info['error_label'] ) ? sanitize_text_field( $failure_info['error_label'] ) : 'AI Provider Error' );
		$model         = ! empty( $failure_info['model'] ) ? sanitize_text_field( $failure_info['model'] ) : 'N/A';
		$timestamp     = ! empty( $failure_info['timestamp'] ) ? sanitize_text_field( $failure_info['timestamp'] ) : current_time( 'mysql' );
		$message       = ! empty( $failure_info['message'] ) ? sanitize_text_field( $failure_info['message'] ) : 'Generation request failed.';

		// Deduplication & Throttling: 1 alert per failure type per provider per hour
		$transient_key = 'cp_alert_' . substr( md5( $provider_slug . '_' . $error_type ), 0, 20 );
		if ( get_transient( $transient_key ) ) {
			\ChatPilot\Common\Logger::log(
				'info',
				sprintf( 'Provider failure email throttled for %s (%s) to prevent inbox flooding.', $provider_slug, $error_type )
			);
			return false;
		}

		$recipient = $settings->get( 'notifications.notification_email', get_option( 'admin_email', '' ) );
		$site_name = get_bloginfo( 'name' );

		// Provider display name
		$provider_name = ucfirst( $provider_slug );
		if ( 'gemini' === $provider_slug ) {
			$provider_name = 'Google Gemini';
		} elseif ( 'openai' === $provider_slug ) {
			$provider_name = 'OpenAI';
		} elseif ( 'openrouter' === $provider_slug ) {
			$provider_name = 'OpenRouter';
		}

		// Subject formatting
		if ( 'quota_exceeded' === $error_type ) {
			$subject = sprintf( '[%s] Chat Pilot AI Provider Warning — Quota Exceeded', $site_name );
		} else {
			$subject = sprintf( '[%s] Chat Pilot AI Provider Alert — %s', $site_name, $error_label );
		}

		$body = sprintf(
			'<!DOCTYPE html><html><body style="font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px;">' .
			'<div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #cbd5e1; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">' .
			'<div style="background: linear-gradient(135deg, #b91c1c 0%%, #991b1b 100%%); padding: 20px 24px; color: #ffffff;">' .
			'<h2 style="margin: 0; font-size: 20px; font-weight: 600;">⚠️ AI Provider Warning — %s</h2>' .
			'<p style="margin: 4px 0 0 0; color: #fca5a5; font-size: 14px;">Chat Pilot System Health Monitor</p>' .
			'</div>' .
			'<div style="padding: 24px;">' .
			'<p style="color: #334155; margin-top: 0; font-size: 15px; line-height: 1.5;">' .
			'Chat Pilot detected an AI provider issue on <strong>%s</strong>.<br>' .
			'The frontend widget is currently returning the safe configured AI generation error fallback to visitors.' .
			'</p>' .
			'<table style="width: 100%%; border-collapse: collapse; margin: 18px 0; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0;">' .
			'<tr><td style="padding: 10px 12px; font-weight: bold; color: #475569; border-bottom: 1px solid #e2e8f0; width: 150px;">Provider:</td><td style="padding: 10px 12px; color: #1e293b; border-bottom: 1px solid #e2e8f0; font-weight: 600;">%s</td></tr>' .
			'<tr><td style="padding: 10px 12px; font-weight: bold; color: #475569; border-bottom: 1px solid #e2e8f0;">Model:</td><td style="padding: 10px 12px; color: #1e293b; border-bottom: 1px solid #e2e8f0; font-family: monospace;">%s</td></tr>' .
			'<tr><td style="padding: 10px 12px; font-weight: bold; color: #475569; border-bottom: 1px solid #e2e8f0;">Issue / Status:</td><td style="padding: 10px 12px; color: #dc2626; font-weight: bold; border-bottom: 1px solid #e2e8f0;">%s</td></tr>' .
			'<tr><td style="padding: 10px 12px; font-weight: bold; color: #475569; border-bottom: 1px solid #e2e8f0;">Time:</td><td style="padding: 10px 12px; color: #1e293b; border-bottom: 1px solid #e2e8f0;">%s</td></tr>' .
			'<tr><td style="padding: 10px 12px; font-weight: bold; color: #475569;">Error Details:</td><td style="padding: 10px 12px; color: #64748b; font-size: 13px; font-family: monospace; word-break: break-word;">%s</td></tr>' .
			'</table>' .
			'<div style="background: #fffbeb; border: 1px solid #fef3c7; border-radius: 8px; padding: 12px 16px; margin-bottom: 20px; font-size: 13px; color: #92400e; line-height: 1.5;">' .
			'<strong>Action Required:</strong> Please review your provider quota, billing, or API tier settings in your AI provider console to restore seamless generation.' .
			'</div>' .
			'<div style="text-align: center; margin-top: 24px;">' .
			'<a href="%s" style="display: inline-block; background: #dc2626; color: #ffffff; text-decoration: none; padding: 10px 20px; border-radius: 6px; font-weight: 600; font-size: 14px;">View Chat Pilot Analytics</a>' .
			'</div>' .
			'</div>' .
			'<div style="background: #f1f5f9; padding: 12px 24px; text-align: center; font-size: 12px; color: #64748b;">' .
			'Automated Provider Alert generated by Chat Pilot on %s (Throttled to 1 email per hour per failure type)' .
			'</div>' .
			'</div></body></html>',
			esc_html( $error_label ),
			esc_html( $site_name ),
			esc_html( $provider_name ),
			esc_html( $model ),
			esc_html( $error_label ),
			esc_html( $timestamp ),
			esc_html( $message ),
			admin_url( 'admin.php?page=chat-pilot&tab=analytics' ),
			esc_html( $site_name )
		);

		$sent = $this->send_notification( $recipient, $subject, $body, array( 'event' => 'provider_failure', 'info' => $failure_info ) );
		if ( $sent ) {
			// Cache transient for 1 hour to prevent flooding
			set_transient( $transient_key, time(), HOUR_IN_SECONDS );
		}

		return $sent;
	}
}
