<?php
/**
 * Chat Pilot uninstall routine.
 *
 * Removes every option this plugin created, including the Site API Key. It does
 * NOT touch anything in Chat Pilot Cloud: knowledge, conversations, leads and
 * analytics stay with the customer's account, and the key can be revoked from
 * the Chat Pilot dashboard.
 *
 * The v1 custom tables are dropped too, so upgrading and then uninstalling does
 * not leave orphaned tables behind.
 */

if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

$chat_pilot_options = array(
	'chat_pilot_options',
	'chat_pilot_site_api_key',
	'chat_pilot_connection_state',
	'chat_pilot_site_token',
	'chat_pilot_widget_config_last_good',
	'chat_pilot_log',
	// Legacy v1 options.
	'chat_pilot_settings',
	'chat_pilot_provider_health_openai',
	'chat_pilot_provider_health_gemini',
);

foreach ( $chat_pilot_options as $chat_pilot_option ) {
	delete_option( $chat_pilot_option );
}

delete_transient( 'chat_pilot_widget_config' );
delete_transient( 'chat_pilot_widget_config_cooldown' );
delete_transient( 'chat_pilot_system_status' );

global $wpdb;

// Drop the tables the v1 plugin created. v2 creates none.
$chat_pilot_tables = array(
	$wpdb->prefix . 'chat_pilot_logs',
	$wpdb->prefix . 'chat_pilot_kb_sources',
	$wpdb->prefix . 'chat_pilot_kb_documents',
	$wpdb->prefix . 'chat_pilot_conversations',
	$wpdb->prefix . 'chat_pilot_forms',
	$wpdb->prefix . 'chat_pilot_form_submissions',
);

foreach ( $chat_pilot_tables as $chat_pilot_table ) {
	// Table names cannot be parameterised; they are built from the trusted
	// $wpdb->prefix and a fixed suffix, so there is no user input here.
	$wpdb->query( 'DROP TABLE IF EXISTS `' . esc_sql( $chat_pilot_table ) . '`' );
}
