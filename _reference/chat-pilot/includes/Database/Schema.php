<?php
namespace ChatPilot\Database;

// Prevent direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class Schema
 * Sets up custom database log schemas and handles initial installations using dbDelta.
 */
class Schema {

	/**
	 * Creates custom plugin tables if they do not exist.
	 */
	public function create_tables() {
		global $wpdb;

		$table_name      = $wpdb->prefix . 'chat_pilot_logs';
		$sources_table   = $wpdb->prefix . 'chat_pilot_kb_sources';
		$docs_table      = $wpdb->prefix . 'chat_pilot_kb_documents';
		$charset_collate = $wpdb->get_charset_collate();

		// Schema definition for the logs table.
		$sql_logs = "CREATE TABLE {$table_name} (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			timestamp datetime DEFAULT CURRENT_TIMESTAMP NOT NULL,
			level varchar(20) NOT NULL,
			message text NOT NULL,
			context text NULL,
			PRIMARY KEY  (id),
			KEY timestamp_idx (timestamp),
			KEY level_idx (level)
		) {$charset_collate};";

		// Schema definition for KB sources.
		$sql_sources = "CREATE TABLE {$sources_table} (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			type varchar(50) NOT NULL,
			name varchar(255) NOT NULL,
			config longtext NOT NULL,
			status varchar(20) NOT NULL,
			last_sync datetime DEFAULT NULL,
			error_message text DEFAULT NULL,
			created_at datetime DEFAULT '0000-00-00 00:00:00' NOT NULL,
			updated_at datetime DEFAULT '0000-00-00 00:00:00' NOT NULL,
			PRIMARY KEY  (id),
			KEY type_idx (type),
			KEY status_idx (status)
		) {$charset_collate};";

		// Schema definition for KB documents.
		$sql_docs = "CREATE TABLE {$docs_table} (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			source_id bigint(20) unsigned NOT NULL,
			title varchar(255) NOT NULL,
			content longtext NOT NULL,
			source_url varchar(2083) NOT NULL,
			metadata longtext NOT NULL,
			status varchar(20) NOT NULL,
			word_count int(11) NOT NULL,
			created_at datetime DEFAULT '0000-00-00 00:00:00' NOT NULL,
			updated_at datetime DEFAULT '0000-00-00 00:00:00' NOT NULL,
			PRIMARY KEY  (id),
			KEY source_id_idx (source_id),
			KEY status_idx (status)
		) {$charset_collate};";

		// Schema definition for Conversations.
		$conversations_table = $wpdb->prefix . 'chat_pilot_conversations';
		$sql_conversations = "CREATE TABLE {$conversations_table} (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			session_id varchar(100) NOT NULL,
			form_id bigint(20) unsigned DEFAULT 0 NOT NULL,
			visitor_name varchar(255) DEFAULT '' NOT NULL,
			visitor_email varchar(255) DEFAULT '' NOT NULL,
			visitor_phone varchar(50) DEFAULT '' NOT NULL,
			source varchar(50) DEFAULT 'widget' NOT NULL,
			status varchar(20) DEFAULT 'active' NOT NULL,
			is_read tinyint(1) DEFAULT 0 NOT NULL,
			messages longtext NOT NULL,
			metadata longtext NOT NULL,
			summary text DEFAULT NULL,
			created_at datetime DEFAULT '2000-01-01 00:00:00' NOT NULL,
			updated_at datetime DEFAULT '2000-01-01 00:00:00' NOT NULL,
			PRIMARY KEY  (id),
			KEY session_id_idx (session_id),
			KEY status_idx (status),
			KEY source_idx (source),
			KEY form_id_idx (form_id)
		) {$charset_collate};";

		// Schema definition for Forms.
		$forms_table = $wpdb->prefix . 'chat_pilot_forms';
		$sql_forms = "CREATE TABLE {$forms_table} (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			name varchar(255) NOT NULL,
			fields longtext NOT NULL,
			is_default tinyint(1) DEFAULT 0 NOT NULL,
			status varchar(20) DEFAULT 'active' NOT NULL,
			created_at datetime DEFAULT '2000-01-01 00:00:00' NOT NULL,
			updated_at datetime DEFAULT '2000-01-01 00:00:00' NOT NULL,
			PRIMARY KEY  (id),
			KEY is_default_idx (is_default),
			KEY status_idx (status)
		) {$charset_collate};";

		// Schema definition for Form Submissions.
		$submissions_table = $wpdb->prefix . 'chat_pilot_form_submissions';
		$sql_submissions = "CREATE TABLE {$submissions_table} (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			form_id bigint(20) unsigned NOT NULL,
			name varchar(255) DEFAULT '' NOT NULL,
			email varchar(255) DEFAULT '' NOT NULL,
			phone varchar(50) DEFAULT '' NOT NULL,
			custom_fields longtext NOT NULL,
			session_id varchar(100) DEFAULT '' NOT NULL,
			conversation_id bigint(20) unsigned DEFAULT 0 NOT NULL,
			page_url varchar(2083) DEFAULT '' NOT NULL,
			created_at datetime DEFAULT '2000-01-01 00:00:00' NOT NULL,
			PRIMARY KEY  (id),
			KEY form_id_idx (form_id),
			KEY conversation_id_idx (conversation_id),
			KEY session_id_idx (session_id)
		) {$charset_collate};";

		// Include WordPress upgrade helper for dbDelta.
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		dbDelta( $sql_logs );
		dbDelta( $sql_sources );
		dbDelta( $sql_docs );
		dbDelta( $sql_conversations );
		dbDelta( $sql_forms );
		dbDelta( $sql_submissions );
	}
}
