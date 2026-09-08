<?php
/**
 * Chat Pilot Uninstallation Handler
 * Brand: Local Marketing Geeks
 */

// Prevent execution if not called by WordPress.
if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

$option_name = 'chat_pilot_options';
$options     = get_option( $option_name, array() );

// Read delete_on_uninstall setting flag from the options array.
$delete_on_uninstall = false;
if ( isset( $options['general']['delete_on_uninstall'] ) ) {
	$delete_on_uninstall = filter_var( $options['general']['delete_on_uninstall'], FILTER_VALIDATE_BOOLEAN );
}

if ( $delete_on_uninstall ) {
	// 1. Delete options tree.
	delete_option( $option_name );

	// 2. Drop custom logging table logs from database.
	global $wpdb;
	$table_name = $wpdb->prefix . 'chat_pilot_logs';
	$wpdb->query( "DROP TABLE IF EXISTS {$table_name}" ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
}
