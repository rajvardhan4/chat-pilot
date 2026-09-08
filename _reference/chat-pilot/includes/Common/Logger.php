<?php
namespace ChatPilot\Common;

// Prevent direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class Logger
 * Handles logging of system events and operations directly to the custom DB logs table.
 */
class Logger {

	/**
	 * Writes a log message to the database log table.
	 *
	 * @param string $level   Log severity level (info, debug, error).
	 * @param string $message Detailed description message.
	 * @param array  $context Optional additional details array.
	 */
	public static function log( $level, $message, array $context = array() ) {
		global $wpdb;

		// Ensure settings is initialized before evaluating logging constraints.
		$plugin = \ChatPilot\Core\Plugin::instance();
		if ( isset( $plugin->settings ) ) {
			$enable_logging = $plugin->settings->get( 'performance.enable_logging', $plugin->settings->get( 'general.enable_logging', true ) );
			if ( ! $enable_logging ) {
				return;
			}

			$dev_mode       = $plugin->settings->get( 'general.dev_mode', false );
			$configured_lvl = strtolower( $plugin->settings->get( 'performance.logging_level', 'info' ) );

			$levels_map = array( 'debug' => 0, 'info' => 1, 'warning' => 2, 'error' => 3 );
			$msg_lvl_rank  = isset( $levels_map[ strtolower( $level ) ] ) ? $levels_map[ strtolower( $level ) ] : 1;
			$cfg_lvl_rank  = isset( $levels_map[ $configured_lvl ] ) ? $levels_map[ $configured_lvl ] : 1;

			if ( ! $dev_mode && $msg_lvl_rank < $cfg_lvl_rank ) {
				return;
			}
		}

		$table_name = $wpdb->prefix . 'chat_pilot_logs';

		$wpdb->insert(
			$table_name,
			array(
				'timestamp' => current_time( 'mysql' ),
				'level'     => sanitize_key( $level ),
				'message'   => sanitize_text_field( $message ),
				'context'   => ! empty( $context ) ? wp_json_encode( $context ) : null,
			),
			array( '%s', '%s', '%s', '%s' )
		);
	}
}
