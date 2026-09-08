<?php
namespace ChatPilot\Common;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class Logger
 * Ring-buffer logger stored in a single option.
 *
 * v1 wrote to a custom table. There is no custom table any more, and the volume
 * here is tiny (connection events and API failures), so a capped option keeps
 * the plugin schema-free while still giving an administrator something to look
 * at when a connection misbehaves.
 *
 * Every message and context value passes through a redactor first, so a Site
 * API Key or provider key can never reach the log.
 */
class Logger {

	const OPTION   = 'chat_pilot_log';
	const MAX_ROWS = 200;

	/**
	 * Redacts anything that looks like a credential.
	 *
	 * @param string $text Raw text.
	 * @return string
	 */
	public static function redact( $text ) {
		$text = (string) $text;
		$text = preg_replace( '/\bcp_(live|test)_[A-Za-z0-9_\-]+/', 'cp_***REDACTED***', $text );
		$text = preg_replace( '/\bsk-[A-Za-z0-9_\-]{8,}/', 'sk-***REDACTED***', $text );
		$text = preg_replace( '/\bAIza[0-9A-Za-z_\-]{10,}/', 'AIza***REDACTED***', $text );
		$text = preg_replace( '/([?&](?:key|token|api_key)=)[^&\s"\']+/i', '$1***REDACTED***', $text );
		$text = preg_replace( '/(Bearer\s+)[A-Za-z0-9._~+\/\-]+=*/i', '$1***REDACTED***', $text );
		return $text;
	}

	/**
	 * Appends a log entry.
	 *
	 * @param string $level   debug|info|warning|error.
	 * @param string $message Message.
	 * @param array  $context Additional detail.
	 */
	public static function log( $level, $message, array $context = array() ) {
		$plugin = \ChatPilot\Core\Plugin::instance();
		if ( isset( $plugin->settings ) && ! $plugin->settings->get( 'logging.enabled', true ) ) {
			return;
		}

		$clean_context = array();
		foreach ( $context as $key => $value ) {
			if ( preg_match( '/(key|secret|token|password|signature)/i', (string) $key ) ) {
				$clean_context[ sanitize_key( $key ) ] = '***REDACTED***';
				continue;
			}
			$clean_context[ sanitize_key( $key ) ] = self::redact( is_scalar( $value ) ? (string) $value : wp_json_encode( $value ) );
		}

		$entries   = self::entries();
		$entries[] = array(
			'time'    => current_time( 'mysql' ),
			'level'   => sanitize_key( $level ),
			'message' => self::redact( sanitize_text_field( $message ) ),
			'context' => $clean_context,
		);

		if ( count( $entries ) > self::MAX_ROWS ) {
			$entries = array_slice( $entries, -self::MAX_ROWS );
		}

		update_option( self::OPTION, $entries, false );
	}

	/**
	 * Reads stored entries, newest last.
	 *
	 * @return array
	 */
	public static function entries() {
		$entries = get_option( self::OPTION, array() );
		return is_array( $entries ) ? $entries : array();
	}

	/**
	 * Reads stored entries, newest first.
	 *
	 * @param int $limit Maximum rows.
	 * @return array
	 */
	public static function recent( $limit = 50 ) {
		$entries = array_reverse( self::entries() );
		return array_slice( $entries, 0, max( 1, (int) $limit ) );
	}

	/**
	 * Empties the log.
	 */
	public static function clear() {
		delete_option( self::OPTION );
	}
}
