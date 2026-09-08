<?php
namespace ChatPilot\Security;

// Prevent direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class Verification
 * Enforces security matrices, capability checking, AJAX route handlers, and nonce audits.
 */
class Verification {

	/**
	 * Constructor. Registers administrative AJAX hooks.
	 */
	public function __construct() {
		add_action( 'wp_ajax_chat_pilot_save_settings', array( $this, 'ajax_save_settings' ) );
		add_action( 'wp_ajax_chat_pilot_dev_action', array( $this, 'ajax_dev_action' ) );
		add_action( 'wp_ajax_chat_pilot_save_provider', array( $this, 'ajax_save_provider' ) );
		add_action( 'wp_ajax_chat_pilot_test_connection', array( $this, 'ajax_test_connection' ) );
		add_action( 'wp_ajax_chat_pilot_save_defaults', array( $this, 'ajax_save_defaults' ) );
		add_action( 'wp_ajax_chat_pilot_playground', array( $this, 'ajax_playground' ) );
		add_action( 'wp_ajax_chat_pilot_save_kb_manual', array( $this, 'ajax_save_kb_manual' ) );
		add_action( 'wp_ajax_chat_pilot_save_kb_faq', array( $this, 'ajax_save_kb_faq' ) );
		add_action( 'wp_ajax_chat_pilot_save_kb_website', array( $this, 'ajax_save_kb_website' ) );
		add_action( 'wp_ajax_chat_pilot_sync_kb_source', array( $this, 'ajax_sync_kb_source' ) );
		add_action( 'wp_ajax_chat_pilot_delete_kb_source', array( $this, 'ajax_delete_kb_source' ) );
		add_action( 'wp_ajax_chat_pilot_upload_kb_file', array( $this, 'ajax_upload_kb_file' ) );
		add_action( 'wp_ajax_chat_pilot_toggle_document_status', array( $this, 'ajax_toggle_document_status' ) );
		add_action( 'wp_ajax_chat_pilot_playground_kb_search', array( $this, 'ajax_playground_kb_search' ) );
		add_action( 'wp_ajax_chat_pilot_crawler_discover', array( $this, 'ajax_crawler_discover' ) );
		add_action( 'wp_ajax_chat_pilot_crawler_process_page', array( $this, 'ajax_crawler_process_page' ) );
		add_action( 'wp_ajax_chat_pilot_crawler_finalize', array( $this, 'ajax_crawler_finalize' ) );
		add_action( 'wp_ajax_chat_pilot_get_document_preview', array( $this, 'ajax_get_document_preview' ) );
		add_action( 'wp_ajax_chat_pilot_crawler_test_retrieval', array( $this, 'ajax_crawler_test_retrieval' ) );
		add_action( 'wp_ajax_chat_pilot_get_source_history', array( $this, 'ajax_get_source_history' ) );
		add_action( 'wp_ajax_chat_pilot_save_instructions', array( $this, 'ajax_save_instructions' ) );
		add_action( 'wp_ajax_chat_pilot_chat', array( $this, 'ajax_chat' ) );
		add_action( 'wp_ajax_nopriv_chat_pilot_chat', array( $this, 'ajax_chat' ) );
		add_action( 'wp_ajax_chat_pilot_get_key_list', array( $this, 'ajax_get_key_list' ) );
		add_action( 'wp_ajax_nopriv_chat_pilot_get_key_list', array( $this, 'ajax_get_key_list' ) );
		add_action( 'wp_ajax_chat_pilot_test_notification_delivery', array( $this, 'ajax_test_notification_delivery' ) );
		add_action( 'wp_ajax_nopriv_chat_pilot_test_notification_delivery', array( $this, 'ajax_test_notification_delivery' ) );
		add_action( 'wp_ajax_chat_pilot_save_widget_settings', array( $this, 'ajax_save_widget_settings' ) );
		add_action( 'wp_ajax_chat_pilot_delete_conversation', array( $this, 'ajax_delete_conversation' ) );
		add_action( 'wp_ajax_chat_pilot_update_conversation_status', array( $this, 'ajax_update_conversation_status' ) );
		add_action( 'wp_ajax_chat_pilot_mark_conversation_read', array( $this, 'ajax_mark_conversation_read' ) );
		add_action( 'wp_ajax_chat_pilot_get_conversation_detail', array( $this, 'ajax_get_conversation_detail' ) );
		add_action( 'wp_ajax_chat_pilot_save_form', array( $this, 'ajax_save_form' ) );
		add_action( 'wp_ajax_chat_pilot_delete_form', array( $this, 'ajax_delete_form' ) );
		add_action( 'wp_ajax_chat_pilot_duplicate_form', array( $this, 'ajax_duplicate_form' ) );
		add_action( 'wp_ajax_chat_pilot_set_default_form', array( $this, 'ajax_set_default_form' ) );
		add_action( 'wp_ajax_chat_pilot_submit_prechat_form', array( $this, 'ajax_submit_prechat_form' ) );
		add_action( 'wp_ajax_nopriv_chat_pilot_submit_prechat_form', array( $this, 'ajax_submit_prechat_form' ) );
		add_action( 'wp_ajax_chat_pilot_get_analytics', array( $this, 'ajax_get_analytics' ) );
		add_action( 'wp_ajax_chat_pilot_save_budget_settings', array( $this, 'ajax_save_budget_settings' ) );
		add_action( 'wp_ajax_chat_pilot_export_analytics_csv', array( $this, 'ajax_export_analytics_csv' ) );
		add_action( 'wp_ajax_chat_pilot_clear_logs', array( $this, 'ajax_clear_logs' ) );
		add_action( 'wp_ajax_chat_pilot_clear_cache', array( $this, 'ajax_clear_cache' ) );
		add_action( 'wp_ajax_chat_pilot_resync_metadata', array( $this, 'ajax_resync_metadata' ) );
		add_action( 'wp_ajax_chat_pilot_reset_section', array( $this, 'ajax_reset_section' ) );
		add_action( 'wp_ajax_chat_pilot_factory_reset', array( $this, 'ajax_factory_reset' ) );
	}

	/**
	 * Validates active session permission flags.
	 */
	public function verify_admin_access() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error( array( 'message' => esc_html__( 'Security Exception: Insufficient Capabilities.', 'chat-pilot' ) ) );
		}
	}

	/**
	 * Validates CSRF anti-forgery nonces.
	 *
	 * @param string $action Nonce identifier token.
	 */
	public function verify_nonce( $action = 'chat_pilot_admin_nonce' ) {
		$nonce = isset( $_POST['_wpnonce'] ) ? sanitize_text_field( wp_unslash( $_POST['_wpnonce'] ) ) : '';
		if ( ! wp_verify_nonce( $nonce, $action ) ) {
			wp_send_json_error( array( 'message' => esc_html__( 'Security Exception: Nonce check failed.', 'chat-pilot' ) ) );
		}
	}

	/**
	 * Handles AJAX-driven settings saves across all global sections.
	 */
	public function ajax_save_settings() {
		$this->verify_admin_access();
		$this->verify_nonce( 'chat_pilot_admin_nonce' );

		$plugin = \ChatPilot\Core\Plugin::instance();

		// 1. General Settings
		if ( isset( $_POST['general'] ) && is_array( $_POST['general'] ) ) {
			$g = $_POST['general'];
			$plugin->settings->set( 'general.plugin_name', \ChatPilot\Settings\Sanitizer::sanitize_text( isset( $g['plugin_name'] ) ? $g['plugin_name'] : 'Chat Pilot' ) );
			$plugin->settings->set( 'general.enable_plugin', \ChatPilot\Settings\Sanitizer::sanitize_boolean( isset( $g['enable_plugin'] ) ? $g['enable_plugin'] : false ) );
			$plugin->settings->set( 'general.default_language', \ChatPilot\Settings\Sanitizer::sanitize_select( isset( $g['default_language'] ) ? $g['default_language'] : 'en', array( 'en', 'es', 'fr', 'de', 'it', 'pt', 'wp' ), 'en' ) );
			$plugin->settings->set( 'general.timezone_mode', \ChatPilot\Settings\Sanitizer::sanitize_select( isset( $g['timezone_mode'] ) ? $g['timezone_mode'] : 'site', array( 'site', 'utc' ), 'site' ) );
			$plugin->settings->set( 'general.dev_mode', \ChatPilot\Settings\Sanitizer::sanitize_boolean( isset( $g['dev_mode'] ) ? $g['dev_mode'] : false ) );
			$plugin->settings->set( 'general.debug_mode', \ChatPilot\Settings\Sanitizer::sanitize_boolean( isset( $g['debug_mode'] ) ? $g['debug_mode'] : false ) );
			$plugin->settings->set( 'general.enable_logging', \ChatPilot\Settings\Sanitizer::sanitize_boolean( isset( $g['enable_logging'] ) ? $g['enable_logging'] : false ) );
			$plugin->settings->set( 'general.delete_on_uninstall', \ChatPilot\Settings\Sanitizer::sanitize_boolean( isset( $g['delete_on_uninstall'] ) ? $g['delete_on_uninstall'] : false ) );
		}

		// 2. AI Defaults (Only sets global default provider and global default model)
		if ( isset( $_POST['ai_defaults'] ) && is_array( $_POST['ai_defaults'] ) ) {
			$ai       = $_POST['ai_defaults'];
			$provider = \ChatPilot\Settings\Sanitizer::sanitize_text( isset( $ai['default_provider'] ) ? wp_unslash( $ai['default_provider'] ) : 'gemini' );
			$model    = \ChatPilot\Settings\Sanitizer::sanitize_text( isset( $ai['default_model'] ) ? wp_unslash( $ai['default_model'] ) : '' );

			if ( ! empty( $provider ) && in_array( $provider, array( 'openai', 'gemini' ), true ) ) {
				$plugin->settings->set( 'ai_defaults.default_provider', $provider );
				$plugin->settings->set( 'default_provider', $provider );
			}
			if ( ! empty( $model ) ) {
				$plugin->settings->set( 'ai_defaults.default_model', $model );
				$plugin->settings->set( 'default_model', $model );
			}
		}

		// 3. Conversation Settings
		if ( isset( $_POST['conversations'] ) && is_array( $_POST['conversations'] ) ) {
			$c = $_POST['conversations'];
			$plugin->settings->set( 'conversations.inactivity_timeout', \ChatPilot\Settings\Sanitizer::sanitize_integer( isset( $c['inactivity_timeout'] ) ? $c['inactivity_timeout'] : 30, 5, 1440 ) );
			$plugin->settings->set( 'conversations.retention_days', \ChatPilot\Settings\Sanitizer::sanitize_integer( isset( $c['retention_days'] ) ? $c['retention_days'] : 90, 0, 3650 ) );
			$plugin->settings->set( 'conversations.max_history_messages', \ChatPilot\Settings\Sanitizer::sanitize_integer( isset( $c['max_history_messages'] ) ? $c['max_history_messages'] : 20, 2, 100 ) );
			$plugin->settings->set( 'conversations.default_status', \ChatPilot\Settings\Sanitizer::sanitize_select( isset( $c['default_status'] ) ? $c['default_status'] : 'active', array( 'active', 'completed' ), 'active' ) );
		}

		// 4. Privacy & Data
		if ( isset( $_POST['privacy'] ) && is_array( $_POST['privacy'] ) ) {
			$p = $_POST['privacy'];
			$plugin->settings->set( 'privacy.store_conversations', \ChatPilot\Settings\Sanitizer::sanitize_boolean( isset( $p['store_conversations'] ) ? $p['store_conversations'] : false ) );
			$plugin->settings->set( 'privacy.store_visitor_info', \ChatPilot\Settings\Sanitizer::sanitize_boolean( isset( $p['store_visitor_info'] ) ? $p['store_visitor_info'] : false ) );
			$plugin->settings->set( 'privacy.data_retention_days', \ChatPilot\Settings\Sanitizer::sanitize_integer( isset( $p['data_retention_days'] ) ? $p['data_retention_days'] : 90, 0, 3650 ) );
			$plugin->settings->set( 'privacy.delete_on_uninstall', \ChatPilot\Settings\Sanitizer::sanitize_boolean( isset( $p['delete_on_uninstall'] ) ? $p['delete_on_uninstall'] : false ) );
			$plugin->settings->set( 'privacy.anonymize_ips', \ChatPilot\Settings\Sanitizer::sanitize_boolean( isset( $p['anonymize_ips'] ) ? $p['anonymize_ips'] : false ) );
		}

		// 5. Notification Settings
		if ( isset( $_POST['notifications'] ) && is_array( $_POST['notifications'] ) ) {
			$n = $_POST['notifications'];
			$email = \ChatPilot\Settings\Sanitizer::sanitize_email( isset( $n['notification_email'] ) ? $n['notification_email'] : '' );
			if ( empty( $email ) ) {
				$email = get_option( 'admin_email' );
			}
			$plugin->settings->set( 'notifications.enable_admin_notifications', \ChatPilot\Settings\Sanitizer::sanitize_boolean( isset( $n['enable_admin_notifications'] ) ? $n['enable_admin_notifications'] : false ) );
			$plugin->settings->set( 'notifications.notify_on_lead', \ChatPilot\Settings\Sanitizer::sanitize_boolean( isset( $n['notify_on_lead'] ) ? $n['notify_on_lead'] : false ) );
			$plugin->settings->set( 'notifications.notify_on_conversation', \ChatPilot\Settings\Sanitizer::sanitize_boolean( isset( $n['notify_on_conversation'] ) ? $n['notify_on_conversation'] : false ) );
			$plugin->settings->set( 'notifications.notification_email', $email );
			$plugin->settings->set( 'notifications.notify_on_budget_warning', \ChatPilot\Settings\Sanitizer::sanitize_boolean( isset( $n['notify_on_budget_warning'] ) ? $n['notify_on_budget_warning'] : false ) );
		}

		// 6. Performance Settings
		if ( isset( $_POST['performance'] ) && is_array( $_POST['performance'] ) ) {
			$pf = $_POST['performance'];
			$plugin->settings->set( 'performance.logging_level', \ChatPilot\Settings\Sanitizer::sanitize_select( isset( $pf['logging_level'] ) ? $pf['logging_level'] : 'info', array( 'info', 'warning', 'error', 'debug' ), 'info' ) );
			$plugin->settings->set( 'performance.enable_logging', \ChatPilot\Settings\Sanitizer::sanitize_boolean( isset( $pf['enable_logging'] ) ? $pf['enable_logging'] : false ) );
			$plugin->settings->set( 'performance.cache_ttl', \ChatPilot\Settings\Sanitizer::sanitize_integer( isset( $pf['cache_ttl'] ) ? $pf['cache_ttl'] : 3600, 60, 864000 ) );
		}

		// 7. Security Settings
		if ( isset( $_POST['security'] ) && is_array( $_POST['security'] ) ) {
			$s = $_POST['security'];
			$plugin->settings->set( 'security.required_capability', \ChatPilot\Settings\Sanitizer::sanitize_select( isset( $s['required_capability'] ) ? $s['required_capability'] : 'manage_options', array( 'manage_options', 'edit_theme_options', 'publish_posts' ), 'manage_options' ) );
			$plugin->settings->set( 'security.mask_sensitive_logs', \ChatPilot\Settings\Sanitizer::sanitize_boolean( isset( $s['mask_sensitive_logs'] ) ? $s['mask_sensitive_logs'] : false ) );
			$plugin->settings->set( 'security.strict_nonce_verification', \ChatPilot\Settings\Sanitizer::sanitize_boolean( isset( $s['strict_nonce_verification'] ) ? $s['strict_nonce_verification'] : false ) );
		}

		// 8. Developer Mode
		if ( isset( $_POST['developer'] ) && is_array( $_POST['developer'] ) ) {
			$d = $_POST['developer'];
			$plugin->settings->set( 'developer.dev_mode', \ChatPilot\Settings\Sanitizer::sanitize_boolean( isset( $d['dev_mode'] ) ? $d['dev_mode'] : false ) );
			$plugin->settings->set( 'developer.debug_mode', \ChatPilot\Settings\Sanitizer::sanitize_boolean( isset( $d['debug_mode'] ) ? $d['debug_mode'] : false ) );
			$plugin->settings->set( 'developer.unminified_scripts', \ChatPilot\Settings\Sanitizer::sanitize_boolean( isset( $d['unminified_scripts'] ) ? $d['unminified_scripts'] : false ) );
			
			// Mirror to general dev_mode / debug_mode
			$plugin->settings->set( 'general.dev_mode', \ChatPilot\Settings\Sanitizer::sanitize_boolean( isset( $d['dev_mode'] ) ? $d['dev_mode'] : false ) );
			$plugin->settings->set( 'general.debug_mode', \ChatPilot\Settings\Sanitizer::sanitize_boolean( isset( $d['debug_mode'] ) ? $d['debug_mode'] : false ) );
		}

		// Knowledge base retrieval threshold
		if ( isset( $_POST['knowledge_base'] ) && is_array( $_POST['knowledge_base'] ) ) {
			$kb = $_POST['knowledge_base'];
			$thresh = isset( $kb['retrieval_threshold'] ) ? floatval( $kb['retrieval_threshold'] ) : 3.0;
			$plugin->settings->set( 'knowledge_base.retrieval_threshold', \ChatPilot\Settings\Sanitizer::sanitize_float( $thresh, 1.0, 10.0 ) );
		}

		$plugin->settings->save();

		\ChatPilot\Common\Logger::log(
			'info',
			'Global Settings updated by user ID: ' . get_current_user_id()
		);

		wp_send_json_success(
			array(
				'message' => esc_html__( 'Global configuration saved successfully.', 'chat-pilot' ),
				'refresh' => true,
			)
		);
	}

	/**
	 * Maintenance Utility: Clear System Database Logs.
	 */
	public function ajax_clear_logs() {
		$this->verify_admin_access();
		$this->verify_nonce( 'chat_pilot_admin_nonce' );

		global $wpdb;
		$table = $wpdb->prefix . 'chat_pilot_logs';
		$wpdb->query( "TRUNCATE TABLE {$table}" );

		\ChatPilot\Common\Logger::log( 'info', 'System logs cleared manually by user ID: ' . get_current_user_id() );

		wp_send_json_success( array( 'message' => esc_html__( 'System database logs cleared successfully.', 'chat-pilot' ) ) );
	}

	/**
	 * Maintenance Utility: Clear Plugin Transients & Cache.
	 */
	public function ajax_clear_cache() {
		$this->verify_admin_access();
		$this->verify_nonce( 'chat_pilot_admin_nonce' );

		global $wpdb;
		$wpdb->query( "DELETE FROM {$wpdb->options} WHERE option_name LIKE '_transient_chat_pilot_%' OR option_name LIKE '_transient_timeout_chat_pilot_%'" );

		wp_send_json_success( array( 'message' => esc_html__( 'Plugin transient cache cleared successfully.', 'chat-pilot' ) ) );
	}

	/**
	 * Maintenance Utility: Re-sync System Database Metadata & Schema.
	 */
	public function ajax_resync_metadata() {
		$this->verify_admin_access();
		$this->verify_nonce( 'chat_pilot_admin_nonce' );

		// Run schema creation tables
		\ChatPilot\Database\Schema::create_tables();

		// Trigger column sync on managers
		new \ChatPilot\Conversations\ConversationManager();
		new \ChatPilot\Forms\FormManager();

		$plugin = \ChatPilot\Core\Plugin::instance();
		$plugin->settings->set( 'system.last_resync_timestamp', current_time( 'mysql' ) );
		$plugin->settings->save();

		wp_send_json_success( array( 'message' => esc_html__( 'Database tables, columns, and system metadata re-synced successfully.', 'chat-pilot' ) ) );
	}

	/**
	 * Maintenance Utility: Reset a Specific Settings Section.
	 */
	public function ajax_reset_section() {
		$this->verify_admin_access();
		$this->verify_nonce( 'chat_pilot_admin_nonce' );

		$section = isset( $_POST['section'] ) ? sanitize_key( $_POST['section'] ) : '';
		if ( empty( $section ) ) {
			wp_send_json_error( array( 'message' => esc_html__( 'Invalid section identifier.', 'chat-pilot' ) ) );
		}

		$plugin   = \ChatPilot\Core\Plugin::instance();
		$defaults = $plugin->settings->get_defaults();

		if ( isset( $defaults[ $section ] ) ) {
			$plugin->settings->set( $section, $defaults[ $section ] );
			$plugin->settings->save();

			wp_send_json_success( array(
				'message' => sprintf( esc_html__( 'Settings for section "%s" reset to default.', 'chat-pilot' ), esc_html( ucfirst( $section ) ) ),
				'refresh' => true,
			) );
		} else {
			wp_send_json_error( array( 'message' => esc_html__( 'Section not found in defaults tree.', 'chat-pilot' ) ) );
		}
	}

	/**
	 * Maintenance Utility: Full System Factory Reset.
	 */
	public function ajax_factory_reset() {
		$this->verify_admin_access();
		$this->verify_nonce( 'chat_pilot_admin_nonce' );

		$confirm = isset( $_POST['confirm_reset'] ) ? sanitize_text_field( $_POST['confirm_reset'] ) : '';
		if ( 'YES' !== strtoupper( $confirm ) ) {
			wp_send_json_error( array( 'message' => esc_html__( 'Factory reset cancelled. Explicit confirmation required.', 'chat-pilot' ) ) );
		}

		$plugin = \ChatPilot\Core\Plugin::instance();
		$plugin->settings->reset_all();

		\ChatPilot\Common\Logger::log( 'warning', 'Full system factory reset performed by user ID: ' . get_current_user_id() );

		wp_send_json_success( array(
			'message' => esc_html__( 'Full system factory reset completed successfully. All settings restored to defaults.', 'chat-pilot' ),
			'refresh' => true,
		) );
	}

	/**
	 * Handles AJAX-driven developer action utilities.
	 */
	public function ajax_dev_action() {
		$this->verify_admin_access();
		$this->verify_nonce( 'chat_pilot_admin_nonce' );

		// Block dev actions if dev mode setting is disabled.
		$action_type = isset( $_POST['action_type'] ) ? sanitize_key( wp_unslash( $_POST['action_type'] ) ) : '';
		if ( ! $plugin->settings->get( 'general.dev_mode', false ) ) {
			wp_send_json_error( array( 'message' => esc_html__( 'Access Blocked: Developer Mode is disabled.', 'chat-pilot' ) ) );
		}

		if ( 'reset_settings' === $action_type ) {
			$plugin->settings->reset_all();
			\ChatPilot\Common\Logger::log( 'info', 'Plugin settings reset to defaults.' );
			wp_send_json_success( array( 'message' => esc_html__( 'All options reset to default values.', 'chat-pilot' ) ) );
		} elseif ( 'clear_logs' === $action_type ) {
			global $wpdb;
			$table_name = $wpdb->prefix . 'chat_pilot_logs';
			$wpdb->query( "TRUNCATE TABLE {$table_name}" ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
			wp_send_json_success( array( 'message' => esc_html__( 'Database logs table truncated successfully.', 'chat-pilot' ) ) );
		} else {
			wp_send_json_error( array( 'message' => esc_html__( 'Unknown developer action parameter.', 'chat-pilot' ) ) );
		}
	}

	/**
	 * Handles AJAX-driven provider configurations saving.
	 */
	public function ajax_save_provider() {
		$this->verify_admin_access();
		$this->verify_nonce( 'chat_pilot_admin_nonce' );

		$slug = isset( $_POST['provider_slug'] ) ? sanitize_key( wp_unslash( $_POST['provider_slug'] ) ) : '';
		if ( ! in_array( $slug, array( 'openai', 'gemini' ), true ) ) {
			wp_send_json_error( array( 'message' => esc_html__( 'Invalid provider slug.', 'chat-pilot' ) ) );
		}

		$plugin   = \ChatPilot\Core\Plugin::instance();
		$incoming = isset( $_POST['provider'] ) ? (array) $_POST['provider'] : array();

		// Handle API Key Masking Check: preserve existing key if field is empty or contains masking characters
		$api_key = isset( $incoming['api_key'] ) ? sanitize_text_field( wp_unslash( $incoming['api_key'] ) ) : '';
		if ( empty( $api_key ) || strpos( $api_key, '*' ) !== false || strpos( $api_key, '•' ) !== false ) {
			$api_key = $plugin->settings->get( "providers.{$slug}.api_key", '' );
		}

		// Update options tree.
		$plugin->settings->set( "providers.{$slug}.enabled", ! empty( $incoming['enabled'] ) );
		$plugin->settings->set( "providers.{$slug}.api_key", $api_key );

		if ( 'openai' === $slug ) {
			$plugin->settings->set( 'providers.openai.org_id', isset( $incoming['org_id'] ) ? sanitize_text_field( wp_unslash( $incoming['org_id'] ) ) : '' );
			$plugin->settings->set( 'providers.openai.base_url', isset( $incoming['base_url'] ) ? esc_url_raw( wp_unslash( $incoming['base_url'] ) ) : 'https://api.openai.com/v1' );
		}

		// Update lifecycle status.
		$current_status = $plugin->settings->get( "providers.{$slug}.status", 'Not Configured' );
		if ( empty( $api_key ) ) {
			$plugin->settings->set( "providers.{$slug}.status", 'Not Configured' );
			$plugin->settings->set( "providers.{$slug}.enabled", false ); // Disable if no key.
		} elseif ( 'Not Configured' === $current_status ) {
			$plugin->settings->set( "providers.{$slug}.status", 'Not Yet Verified' );
		}

		// Keep original models lists and default models.
		$default_model = isset( $incoming['default_model'] ) ? sanitize_text_field( wp_unslash( $incoming['default_model'] ) ) : '';
		if ( ! empty( $default_model ) ) {
			$plugin->settings->set( "providers.{$slug}.default_model", $default_model );
			
			// Automatically synchronize with AI Instructions default model
			$active_provider = $plugin->settings->get( 'default_provider', 'gemini' );
			if ( empty( $active_provider ) || $active_provider === $slug ) {
				$plugin->settings->set( 'default_model', $default_model );
				$plugin->settings->set( 'ai_defaults.default_model', $default_model );
				$plugin->settings->set( 'default_provider', $slug );
				$plugin->settings->set( 'ai_defaults.default_provider', $slug );
			}
		}

		$plugin->settings->save();

		// Log settings updates.
		\ChatPilot\Common\Logger::log(
			'info',
			sprintf( 'AI Provider %s configuration settings saved. Status: %s.', esc_html( $slug ), esc_html( $plugin->settings->get( "providers.{$slug}.status" ) ) )
		);

		wp_send_json_success( array( 'message' => esc_html__( 'Provider configuration updated successfully.', 'chat-pilot' ) ) );
	}

	/**
	 * Handles AJAX-driven provider connection testing.
	 */
	public function ajax_test_connection() {
		$this->verify_admin_access();
		$this->verify_nonce( 'chat_pilot_admin_nonce' );

		$slug = isset( $_POST['provider_slug'] ) ? sanitize_key( wp_unslash( $_POST['provider_slug'] ) ) : '';
		if ( ! in_array( $slug, array( 'openai', 'gemini' ), true ) ) {
			wp_send_json_error( array( 'message' => esc_html__( 'Invalid provider slug.', 'chat-pilot' ) ) );
		}

		$plugin   = \ChatPilot\Core\Plugin::instance();
		$incoming = isset( $_POST['provider'] ) ? (array) $_POST['provider'] : array();

		// Handle API Key Masking Check.
		$api_key = isset( $incoming['api_key'] ) ? sanitize_text_field( wp_unslash( $incoming['api_key'] ) ) : '';
		if ( strpos( $api_key, '***' ) !== false ) {
			$api_key = $plugin->settings->get( "providers.{$slug}.api_key", '' );
		}

		$config = array(
			'api_key' => $api_key,
		);

		if ( 'openai' === $slug ) {
			$config['org_id']   = isset( $incoming['org_id'] ) ? sanitize_text_field( wp_unslash( $incoming['org_id'] ) ) : '';
			$config['base_url'] = isset( $incoming['base_url'] ) ? esc_url_raw( wp_unslash( $incoming['base_url'] ) ) : 'https://api.openai.com/v1';
		}

		$result = $plugin->providers->test_connection( $slug, $config );

		// Fetch the saved status directly after test_connection runs
		$status = $plugin->settings->get( "providers.{$slug}.status", 'Not Configured' );

		if ( $result['success'] ) {
			// Save the configuration and automatically activate the provider!
			$plugin->settings->set( "providers.{$slug}.api_key", $api_key );
			$plugin->settings->set( "providers.{$slug}.enabled", true );
			if ( 'openai' === $slug ) {
				$plugin->settings->set( 'providers.openai.org_id', $config['org_id'] );
				$plugin->settings->set( 'providers.openai.base_url', $config['base_url'] );
			}
			$plugin->settings->save();

			$models = $plugin->settings->get( "providers.{$slug}.models", array() );
			wp_send_json_success(
				array(
					'message' => esc_html__( 'Connected & Activated Successfully.', 'chat-pilot' ),
					'latency' => $result['latency'],
					'models'  => $models,
					'status'  => $status,
				)
			);
		} else {
			// Automatically deactivate if connection fails
			$plugin->settings->set( "providers.{$slug}.enabled", false );
			$plugin->settings->save();

			wp_send_json_error(
				array(
					'message' => $result['message'],
					'status'  => $status,
				)
			);
		}
	}

	/**
	 * Handles AJAX-driven default provider and default model saving.
	 */
	public function ajax_save_defaults() {
		$this->verify_admin_access();
		$this->verify_nonce( 'chat_pilot_admin_nonce' );

		$default_provider = isset( $_POST['default_provider'] ) ? sanitize_key( wp_unslash( $_POST['default_provider'] ) ) : '';
		$default_model    = isset( $_POST['default_model'] ) ? sanitize_text_field( wp_unslash( $_POST['default_model'] ) ) : '';

		if ( ! empty( $default_provider ) && ! in_array( $default_provider, array( 'openai', 'gemini' ), true ) ) {
			wp_send_json_error( array( 'message' => esc_html__( 'Invalid default provider selection.', 'chat-pilot' ) ) );
		}

		$plugin = \ChatPilot\Core\Plugin::instance();
		$plugin->settings->set( 'default_provider', $default_provider );
		$plugin->settings->set( 'default_model', $default_model );
		$plugin->settings->save();

		// Log change.
		\ChatPilot\Common\Logger::log(
			'info',
			sprintf( 'Global default AI provider set to %s, default model set to %s.', esc_html( $default_provider ), esc_html( $default_model ) )
		);

		wp_send_json_success( array( 'message' => esc_html__( 'Global default settings updated successfully.', 'chat-pilot' ) ) );
	}

	/**
	 * Handles AJAX completions requests for the Playground developer testing tools.
	 */
	public function ajax_playground() {
		$this->verify_admin_access();
		$this->verify_nonce( 'chat_pilot_admin_nonce' );

		$provider_slug = isset( $_POST['provider'] ) ? sanitize_key( wp_unslash( $_POST['provider'] ) ) : '';
		$model         = isset( $_POST['model'] ) ? sanitize_text_field( wp_unslash( $_POST['model'] ) ) : '';
		$prompt        = isset( $_POST['prompt'] ) ? sanitize_textarea_field( wp_unslash( $_POST['prompt'] ) ) : '';

		if ( empty( $prompt ) ) {
			wp_send_json_error( array( 'message' => esc_html__( 'Prompt text is required.', 'chat-pilot' ) ) );
		}

		$plugin = \ChatPilot\Core\Plugin::instance();
		$driver = $plugin->providers->get_provider( $provider_slug );

		if ( ! $driver ) {
			wp_send_json_error( array( 'message' => esc_html__( 'AI Connection adapter not found.', 'chat-pilot' ) ) );
		}

		// Build configuration array from stored parameters.
		$config = array(
			'api_key'       => $plugin->settings->get( "providers.{$provider_slug}.api_key", '' ),
			'base_url'      => $plugin->settings->get( "providers.{$provider_slug}.base_url", '' ),
			'org_id'        => $plugin->settings->get( "providers.{$provider_slug}.org_id", '' ),
			'default_model' => $model,
		);

		if ( empty( $config['api_key'] ) ) {
			wp_send_json_error( array( 'message' => esc_html__( 'API Credentials missing for the selected provider.', 'chat-pilot' ) ) );
		}

		$response = $driver->sendPrompt( $config, $prompt );

		if ( $response['success'] ) {
			wp_send_json_success(
				array(
					'text'    => $response['text'],
					'tokens'  => isset( $response['tokens'] ) ? $response['tokens'] : 0,
					'latency' => $response['latency'],
				)
			);
		} else {
			wp_send_json_error(
				array(
					'message' => $response['message'],
				)
			);
		}
	}

	/**
	 * Handles AJAX save or update for manual KB entries.
	 */
	public function ajax_save_kb_manual() {
		$this->verify_admin_access();
		$this->verify_nonce( 'chat_pilot_admin_nonce' );

		$source_id = isset( $_POST['source_id'] ) ? intval( $_POST['source_id'] ) : 0;
		$title     = isset( $_POST['title'] ) ? sanitize_text_field( wp_unslash( $_POST['title'] ) ) : '';
		$content   = isset( $_POST['content'] ) ? wp_kses_post( wp_unslash( $_POST['content'] ) ) : '';
		$category  = isset( $_POST['category'] ) ? sanitize_text_field( wp_unslash( $_POST['category'] ) ) : '';
		$tags      = isset( $_POST['tags'] ) ? sanitize_text_field( wp_unslash( $_POST['tags'] ) ) : '';

		if ( empty( $title ) || empty( $content ) ) {
			wp_send_json_error( array( 'message' => esc_html__( 'Title and content are required.', 'chat-pilot' ) ) );
		}

		$kb_manager = new \ChatPilot\KB\KBManager();
		$config     = array(
			'content'  => $content,
			'category' => $category,
			'tags'     => $tags,
		);

		global $wpdb;
		$sources_table = $wpdb->prefix . 'chat_pilot_kb_sources';

		if ( $source_id > 0 ) {
			// Update.
			$wpdb->update(
				$sources_table,
				array(
					'name'       => $title,
					'config'     => wp_json_encode( $config ),
					'updated_at' => current_time( 'mysql' ),
				),
				array( 'id' => $source_id )
			);
		} else {
			// Create.
			$source_id = $kb_manager->add_source( 'manual', $title, $config );
		}

		if ( ! $source_id ) {
			wp_send_json_error( array( 'message' => esc_html__( 'Failed to save manual knowledge entry.', 'chat-pilot' ) ) );
		}

		// Trigger Sync.
		$kb_manager->sync_source( $source_id );

		wp_send_json_success( array( 'message' => esc_html__( 'Manual knowledge entry saved successfully.', 'chat-pilot' ) ) );
	}

	/**
	 * Handles AJAX save or update for FAQ KB entries.
	 */
	public function ajax_save_kb_faq() {
		$this->verify_admin_access();
		$this->verify_nonce( 'chat_pilot_admin_nonce' );

		$source_id  = isset( $_POST['source_id'] ) ? intval( $_POST['source_id'] ) : 0;
		$category   = isset( $_POST['category'] ) ? sanitize_text_field( wp_unslash( $_POST['category'] ) ) : '';
		$bulk_paste = isset( $_POST['bulk_paste'] ) ? wp_unslash( $_POST['bulk_paste'] ) : '';

		$kb_manager = new \ChatPilot\KB\KBManager();

		// Case A: Create Mode with Bulk Paste Textarea
		if ( $source_id <= 0 && ! empty( trim( $bulk_paste ) ) ) {
			$bulk_paste = str_replace( array( "\r\n", "\r" ), "\n", $bulk_paste );
			$pattern = '/(?:^|\n)(?:Q|Question)\s*:\s*(.*?)\n(?:A|Answer)\s*:\s*(.*?)(?=\n(?:Q|Question)\s*:|$)/is';
			preg_match_all( $pattern, $bulk_paste, $matches, PREG_SET_ORDER );
			
			$pairs = array();
			foreach ( $matches as $match ) {
				$q_text = trim( sanitize_text_field( $match[1] ) );
				$a_text = trim( wp_kses_post( $match[2] ) );
				if ( ! empty( $q_text ) && ! empty( $a_text ) ) {
					$pairs[] = array(
						'question' => $q_text,
						'answer'   => $a_text,
					);
				}
			}

			if ( empty( $pairs ) ) {
				wp_send_json_error( array( 'message' => esc_html__( 'No valid Q: and A: pairs could be detected. Please ensure you format your FAQs with "Q: Question" followed by "A: Answer".', 'chat-pilot' ) ) );
			}

			$success_count = 0;
			foreach ( $pairs as $pair ) {
				$config = array(
					'question' => $pair['question'],
					'answer'   => $pair['answer'],
					'category' => $category,
				);
				$new_id = $kb_manager->add_source( 'faq', $pair['question'], $config );
				if ( $new_id ) {
					$kb_manager->sync_source( $new_id );
					$success_count++;
				}
			}

			wp_send_json_success( array( 'message' => sprintf( esc_html__( 'Successfully imported %d FAQ entries.', 'chat-pilot' ), $success_count ) ) );
		}

		// Case B: Single FAQ Save or Edit Update (Fallback)
		$question = isset( $_POST['question'] ) ? sanitize_text_field( wp_unslash( $_POST['question'] ) ) : '';
		$answer   = isset( $_POST['answer'] ) ? wp_kses_post( wp_unslash( $_POST['answer'] ) ) : '';

		if ( empty( $question ) || empty( $answer ) ) {
			wp_send_json_error( array( 'message' => esc_html__( 'Question and answer are required.', 'chat-pilot' ) ) );
		}

		$config = array(
			'question' => $question,
			'answer'   => $answer,
			'category' => $category,
		);

		global $wpdb;
		$sources_table = $wpdb->prefix . 'chat_pilot_kb_sources';

		if ( $source_id > 0 ) {
			// Update.
			$wpdb->update(
				$sources_table,
				array(
					'name'       => $question,
					'config'     => wp_json_encode( $config ),
					'updated_at' => current_time( 'mysql' ),
				),
				array( 'id' => $source_id )
			);
		} else {
			// Create single FAQ.
			$source_id = $kb_manager->add_source( 'faq', $question, $config );
		}

		if ( ! $source_id ) {
			wp_send_json_error( array( 'message' => esc_html__( 'Failed to save FAQ entry.', 'chat-pilot' ) ) );
		}

		// Trigger Sync.
		$kb_manager->sync_source( $source_id );

		wp_send_json_success( array( 'message' => esc_html__( 'FAQ entry saved successfully.', 'chat-pilot' ) ) );
	}

	/**
	 * Handles AJAX save or update for Website Crawler sources.
	 */
	public function ajax_save_kb_website() {
		$this->verify_admin_access();
		$this->verify_nonce( 'chat_pilot_admin_nonce' );

		$url       = isset( $_POST['url'] ) ? esc_url_raw( wp_unslash( $_POST['url'] ) ) : '';
		$max_pages = isset( $_POST['max_pages'] ) ? intval( $_POST['max_pages'] ) : 15;

		if ( empty( $url ) || ! filter_var( $url, FILTER_VALIDATE_URL ) ) {
			wp_send_json_error( array( 'message' => esc_html__( 'A valid website URL is required.', 'chat-pilot' ) ) );
		}

		$kb_manager = new \ChatPilot\KB\KBManager();
		$config     = array(
			'url'       => $url,
			'max_pages' => $max_pages,
		);

		$source_id = $kb_manager->add_source( 'website', $url, $config );

		if ( ! $source_id ) {
			wp_send_json_error( array( 'message' => esc_html__( 'Failed to register website crawling source.', 'chat-pilot' ) ) );
		}

		// Trigger Sync.
		$synced = $kb_manager->sync_source( $source_id );

		if ( ! $synced ) {
			global $wpdb;
			$sources_table = $wpdb->prefix . 'chat_pilot_kb_sources';
			$error = $wpdb->get_var( $wpdb->prepare( "SELECT error_message FROM {$sources_table} WHERE id = %d", $source_id ) );
			wp_send_json_error( array( 'message' => sprintf( esc_html__( 'Website crawler registered, but crawl failed: %s', 'chat-pilot' ), $error ) ) );
		}

		wp_send_json_success( array( 'message' => esc_html__( 'Website crawled and ingested successfully.', 'chat-pilot' ) ) );
	}

	/**
	 * Handles AJAX trigger to re-sync/re-process a knowledge source.
	 */
	public function ajax_sync_kb_source() {
		$this->verify_admin_access();
		$this->verify_nonce( 'chat_pilot_admin_nonce' );

		$source_id = isset( $_POST['source_id'] ) ? intval( $_POST['source_id'] ) : 0;
		if ( $source_id <= 0 ) {
			wp_send_json_error( array( 'message' => esc_html__( 'Invalid source ID.', 'chat-pilot' ) ) );
		}

		$kb_manager = new \ChatPilot\KB\KBManager();
		$synced     = $kb_manager->sync_source( $source_id );

		if ( $synced ) {
			wp_send_json_success( array( 'message' => esc_html__( 'Source synchronized successfully.', 'chat-pilot' ) ) );
		} else {
			global $wpdb;
			$sources_table = $wpdb->prefix . 'chat_pilot_kb_sources';
			$error = $wpdb->get_var( $wpdb->prepare( "SELECT error_message FROM {$sources_table} WHERE id = %d", $source_id ) );
			wp_send_json_error( array( 'message' => sprintf( esc_html__( 'Synchronization failed: %s', 'chat-pilot' ), $error ) ) );
		}
	}

	/**
	 * Handles AJAX source deletion.
	 */
	public function ajax_delete_kb_source() {
		$this->verify_admin_access();
		$this->verify_nonce( 'chat_pilot_admin_nonce' );

		$source_id = isset( $_POST['source_id'] ) ? intval( $_POST['source_id'] ) : 0;
		if ( $source_id <= 0 ) {
			wp_send_json_error( array( 'message' => esc_html__( 'Invalid source ID.', 'chat-pilot' ) ) );
		}

		$kb_manager = new \ChatPilot\KB\KBManager();
		$deleted    = $kb_manager->delete_source( $source_id );

		if ( $deleted ) {
			wp_send_json_success( array( 'message' => esc_html__( 'Source and documents deleted successfully.', 'chat-pilot' ) ) );
		} else {
			wp_send_json_error( array( 'message' => esc_html__( 'Failed to delete knowledge source.', 'chat-pilot' ) ) );
		}
	}

	/**
	 * Handles AJAX document files upload (PDF, DOCX, TXT).
	 */
	public function ajax_upload_kb_file() {
		$this->verify_admin_access();
		$this->verify_nonce( 'chat_pilot_admin_nonce' );

		if ( empty( $_FILES['kb_file'] ) ) {
			wp_send_json_error( array( 'message' => esc_html__( 'No file uploaded.', 'chat-pilot' ) ) );
		}

		$file     = $_FILES['kb_file'];
		$file_ext = strtolower( pathinfo( $file['name'], PATHINFO_EXTENSION ) );

		if ( ! in_array( $file_ext, array( 'pdf', 'docx', 'txt' ), true ) ) {
			wp_send_json_error( array( 'message' => esc_html__( 'Unsupported file type. Only PDF, DOCX, and TXT files are allowed.', 'chat-pilot' ) ) );
		}

		// Handle file upload safely.
		require_once ABSPATH . 'wp-admin/includes/file.php';
		$upload = wp_handle_upload( $file, array( 'test_form' => false ) );

		if ( isset( $upload['error'] ) ) {
			wp_send_json_error( array( 'message' => $upload['error'] ) );
		}

		$kb_manager = new \ChatPilot\KB\KBManager();
		$config     = array(
			'file_path'     => $upload['file'],
			'original_name' => $file['name'],
			'file_url'      => $upload['url'],
		);

		$source_id = $kb_manager->add_source( 'file', $file['name'], $config );
		if ( ! $source_id ) {
			@unlink( $upload['file'] );
			wp_send_json_error( array( 'message' => esc_html__( 'Failed to register upload source.', 'chat-pilot' ) ) );
		}

		// Sync immediately.
		$synced = $kb_manager->sync_source( $source_id );
		if ( ! $synced ) {
			wp_send_json_error( array( 'message' => esc_html__( 'File uploaded, but text parsing failed.', 'chat-pilot' ) ) );
		}

		wp_send_json_success( array( 'message' => esc_html__( 'File uploaded and ingested successfully.', 'chat-pilot' ) ) );
	}

	/**
	 * Handles AJAX toggle of document enabled/disabled status.
	 */
	public function ajax_toggle_document_status() {
		$this->verify_admin_access();
		$this->verify_nonce( 'chat_pilot_admin_nonce' );

		$doc_id = isset( $_POST['doc_id'] ) ? intval( $_POST['doc_id'] ) : 0;
		$enable = isset( $_POST['enable'] ) ? filter_var( $_POST['enable'], FILTER_VALIDATE_BOOLEAN ) : false;

		if ( $doc_id <= 0 ) {
			wp_send_json_error( array( 'message' => esc_html__( 'Invalid document ID.', 'chat-pilot' ) ) );
		}

		$kb_manager = new \ChatPilot\KB\KBManager();
		$updated    = $kb_manager->toggle_document_status( $doc_id, $enable );

		if ( $updated ) {
			wp_send_json_success( array( 'message' => esc_html__( 'Document status updated successfully.', 'chat-pilot' ) ) );
		} else {
			wp_send_json_error( array( 'message' => esc_html__( 'Failed to update document status.', 'chat-pilot' ) ) );
		}
	}

	/**
	 * Handles AJAX retrieval test search (useful for playground verification).
	 */
	public function ajax_playground_kb_search() {
		$this->verify_admin_access();
		$this->verify_nonce( 'chat_pilot_admin_nonce' );

		$query = isset( $_POST['query'] ) ? sanitize_text_field( wp_unslash( $_POST['query'] ) ) : '';
		if ( empty( $query ) ) {
			wp_send_json_error( array( 'message' => esc_html__( 'Query string is required.', 'chat-pilot' ) ) );
		}

		global $wpdb;
		$docs_table = $wpdb->prefix . 'chat_pilot_kb_documents';
		$total_docs = $wpdb->get_var( "SELECT COUNT(*) FROM {$docs_table} WHERE status = 'enabled'" );
		$total_docs = intval( $total_docs );

		$plugin    = \ChatPilot\Core\Plugin::instance();
		$threshold = floatval( $plugin->settings->get( 'knowledge_base.retrieval_threshold', 3.0 ) );

		$engine    = new \ChatPilot\KB\RetrievalEngine();
		// Fetch matching candidate documents by bypassing threshold filtering for thorough analysis
		$documents = $engine->search( $query, 5, true );

		$highest_score = 0.0;
		$formatted     = array();

		foreach ( $documents as $doc ) {
			$score = floatval( $doc['relevance_score'] );
			if ( $score > $highest_score ) {
				$highest_score = $score;
			}
			$formatted[] = array(
				'title'           => $doc['title'],
				'source'          => $doc['source_name'],
				'source_type'     => $doc['source_type'],
				'word_count'      => $doc['word_count'],
				'relevance_score' => $score,
				'passed'          => ( $score >= $threshold ),
				'content'         => wp_trim_words( $doc['content'], 40, '...' ),
			);
		}

		$status = ( $highest_score >= $threshold ) ? 'passed' : 'failed';

		wp_send_json_success(
			array(
				'query'                => $query,
				'total_docs_searched'  => $total_docs,
				'highest_score'        => $highest_score,
				'configured_threshold' => $threshold,
				'status'               => $status,
				'documents'            => $formatted,
			)
		);
	}

	/**
	 * AJAX endpoint to connect to website, discover internal URLs, and register/rescan the source.
	 */
	public function ajax_crawler_discover() {
		$this->verify_admin_access();
		$this->verify_nonce( 'chat_pilot_admin_nonce' );

		$url       = isset( $_POST['url'] ) ? esc_url_raw( wp_unslash( $_POST['url'] ) ) : '';
		$max_pages = isset( $_POST['max_pages'] ) ? intval( $_POST['max_pages'] ) : 15;

		if ( empty( $url ) || ! filter_var( $url, FILTER_VALIDATE_URL ) ) {
			wp_send_json_error( array( 'message' => esc_html__( 'A valid website URL is required.', 'chat-pilot' ) ) );
		}

		$crawler = new \ChatPilot\KB\WebCrawler();
		$urls    = $crawler->discover_links( $url, $max_pages );

		if ( empty( $urls ) ) {
			wp_send_json_error( array( 'message' => esc_html__( 'Failed to connect or find internal links on this website.', 'chat-pilot' ) ) );
		}

		global $wpdb;
		$sources_table = $wpdb->prefix . 'chat_pilot_kb_sources';
		$docs_table    = $wpdb->prefix . 'chat_pilot_kb_documents';

		// Check if source with this URL/Type already exists to update it (Rescan scenario)
		$existing = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$sources_table} WHERE type = 'website' AND name = %s", $url ), ARRAY_A );

		$history = array();
		if ( $existing ) {
			$source_id = intval( $existing['id'] );
			$exist_config = json_decode( $existing['config'], true );
			if ( is_array( $exist_config ) && isset( $exist_config['history'] ) ) {
				$history = $exist_config['history'];
			}
			$config = array(
				'url'       => $url,
				'max_pages' => $max_pages,
				'history'   => $history,
			);
			$wpdb->update(
				$sources_table,
				array(
					'config'        => wp_json_encode( $config ),
					'status'        => 'processing',
					'error_message' => null,
					'updated_at'    => current_time( 'mysql' ),
				),
				array( 'id' => $source_id )
			);
		} else {
			$config = array(
				'url'       => $url,
				'max_pages' => $max_pages,
				'history'   => $history,
			);
			$wpdb->insert(
				$sources_table,
				array(
					'type'       => 'website',
					'name'       => $url,
					'config'     => wp_json_encode( $config ),
					'status'     => 'processing',
					'created_at' => current_time( 'mysql' ),
					'updated_at' => current_time( 'mysql' ),
				)
			);
			$source_id = intval( $wpdb->insert_id );
		}

		// Clear old documents for a clean sync
		$wpdb->delete( $docs_table, array( 'source_id' => $source_id ) );

		wp_send_json_success(
			array(
				'source_id' => $source_id,
				'urls'      => $urls,
			)
		);
	}

	/**
	 * AJAX endpoint to crawl and ingest a single webpage.
	 */
	public function ajax_crawler_process_page() {
		$this->verify_admin_access();
		$this->verify_nonce( 'chat_pilot_admin_nonce' );

		$source_id = isset( $_POST['source_id'] ) ? intval( $_POST['source_id'] ) : 0;
		$url       = isset( $_POST['url'] ) ? esc_url_raw( wp_unslash( $_POST['url'] ) ) : '';

		if ( $source_id <= 0 || empty( $url ) ) {
			wp_send_json_error( array( 'message' => esc_html__( 'Invalid request parameters.', 'chat-pilot' ) ) );
		}

		$crawler   = new \ChatPilot\KB\WebCrawler();
		$page_data = $crawler->crawl_single_page( $url );

		if ( ! $page_data ) {
			// Skip page gracefully so progress can continue
			wp_send_json_success(
				array(
					'url'     => $url,
					'skipped' => true,
				)
			);
		}

		global $wpdb;
		$docs_table = $wpdb->prefix . 'chat_pilot_kb_documents';

		// Run auto classification heuristic and save to metadata
		$metadata = is_array( $page_data['metadata'] ) ? $page_data['metadata'] : array();
		$metadata['category'] = \ChatPilot\KB\KBManager::classify_document( $page_data['title'], $page_data['content'], $page_data['source_url'] );

		// Insert single page document snippet
		$wpdb->insert(
			$docs_table,
			array(
				'source_id'  => $source_id,
				'title'      => sanitize_text_field( $page_data['title'] ),
				'content'    => $page_data['content'],
				'source_url' => esc_url_raw( $page_data['source_url'] ),
				'metadata'   => wp_json_encode( $metadata ),
				'word_count' => intval( $metadata['word_count'] ),
				'status'     => 'enabled',
				'created_at' => current_time( 'mysql' ),
				'updated_at' => current_time( 'mysql' ),
			)
		);

		wp_send_json_success(
			array(
				'url'        => $url,
				'title'      => $page_data['title'],
				'word_count' => intval( $page_data['metadata']['word_count'] ),
				'skipped'    => false,
			)
		);
	}

	/**
	 * AJAX endpoint to finalize the crawl settings, update history array, and set status to completed.
	 */
	public function ajax_crawler_finalize() {
		$this->verify_admin_access();
		$this->verify_nonce( 'chat_pilot_admin_nonce' );

		$source_id        = isset( $_POST['source_id'] ) ? intval( $_POST['source_id'] ) : 0;
		$duration         = isset( $_POST['duration_seconds'] ) ? intval( $_POST['duration_seconds'] ) : 0;
		$discovered_count = isset( $_POST['discovered_count'] ) ? intval( $_POST['discovered_count'] ) : 0;
		$imported_count   = isset( $_POST['imported_count'] ) ? intval( $_POST['imported_count'] ) : 0;
		$skipped_count    = isset( $_POST['skipped_count'] ) ? intval( $_POST['skipped_count'] ) : 0;

		if ( $source_id <= 0 ) {
			wp_send_json_error( array( 'message' => esc_html__( 'Invalid source ID.', 'chat-pilot' ) ) );
		}

		global $wpdb;
		$sources_table = $wpdb->prefix . 'chat_pilot_kb_sources';

		$source = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$sources_table} WHERE id = %d", $source_id ), ARRAY_A );
		if ( ! $source ) {
			wp_send_json_error( array( 'message' => esc_html__( 'Source record not found.', 'chat-pilot' ) ) );
		}

		$config = json_decode( $source['config'], true );
		if ( ! is_array( $config ) ) {
			$config = array();
		}
		if ( ! isset( $config['history'] ) || ! is_array( $config['history'] ) ) {
			$config['history'] = array();
		}

		// Prepend new history record
		$history_item = array(
			'timestamp'  => current_time( 'mysql' ),
			'duration'   => $duration,
			'discovered' => $discovered_count,
			'imported'   => $imported_count,
			'skipped'    => $skipped_count,
			'status'     => 'completed',
		);
		array_unshift( $config['history'], $history_item );

		// Keep only the last 15 history items to limit database size
		$config['history'] = array_slice( $config['history'], 0, 15 );

		$wpdb->update(
			$sources_table,
			array(
				'status'    => 'completed',
				'config'    => wp_json_encode( $config ),
				'last_sync' => current_time( 'mysql' ),
			),
			array( 'id' => $source_id )
		);

		// Fetch successfully imported pages list
		$docs_table = $wpdb->prefix . 'chat_pilot_kb_documents';
		$docs = $wpdb->get_results( $wpdb->prepare( "SELECT id, title, source_url FROM {$docs_table} WHERE source_id = %d ORDER BY id ASC", $source_id ), ARRAY_A );

		wp_send_json_success(
			array(
				'message'   => esc_html__( 'Website crawl summary generated successfully.', 'chat-pilot' ),
				'summary'   => $history_item,
				'documents' => $docs,
			)
		);
	}

	/**
	 * AJAX endpoint to fetch a parsed page preview content.
	 */
	public function ajax_get_document_preview() {
		$this->verify_admin_access();
		$this->verify_nonce( 'chat_pilot_admin_nonce' );

		$doc_id = isset( $_POST['doc_id'] ) ? intval( $_POST['doc_id'] ) : 0;

		if ( $doc_id <= 0 ) {
			wp_send_json_error( array( 'message' => esc_html__( 'Invalid document ID.', 'chat-pilot' ) ) );
		}

		global $wpdb;
		$docs_table = $wpdb->prefix . 'chat_pilot_kb_documents';

		$doc = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$docs_table} WHERE id = %d", $doc_id ), ARRAY_A );

		if ( ! $doc ) {
			wp_send_json_error( array( 'message' => esc_html__( 'Document not found.', 'chat-pilot' ) ) );
		}

		wp_send_json_success(
			array(
				'title'   => $doc['title'],
				'content' => esc_html( $doc['content'] ),
				'url'     => esc_url( $doc['source_url'] ),
			)
		);
	}

	/**
	 * AJAX endpoint to run keyword search queries targeting only a specific website source.
	 */
	public function ajax_crawler_test_retrieval() {
		$this->verify_admin_access();
		$this->verify_nonce( 'chat_pilot_admin_nonce' );

		$source_id = isset( $_POST['source_id'] ) ? intval( $_POST['source_id'] ) : 0;
		$query     = isset( $_POST['query'] ) ? sanitize_text_field( wp_unslash( $_POST['query'] ) ) : '';

		if ( $source_id <= 0 || empty( $query ) ) {
			wp_send_json_error( array( 'message' => esc_html__( 'Source ID and search query are required.', 'chat-pilot' ) ) );
		}

		$engine  = new \ChatPilot\KB\RetrievalEngine();
		$results = $engine->search( $query, 10 );

		$filtered = array();
		foreach ( $results as $res ) {
			if ( intval( $res['source_id'] ) === $source_id ) {
				$filtered[] = array(
					'title'           => $res['title'],
					'relevance_score' => $res['relevance_score'],
					'word_count'      => $res['word_count'],
					'content'         => wp_trim_words( $res['content'], 40, '...' ),
				);
			}
		}

		wp_send_json_success( array( 'documents' => $filtered ) );
	}

	/**
	 * AJAX endpoint to retrieve scan history logs for a specific website URL.
	 */
	public function ajax_get_source_history() {
		$this->verify_admin_access();
		$this->verify_nonce( 'chat_pilot_admin_nonce' );

		$action_type = isset( $_POST['action_type'] ) ? sanitize_key( $_POST['action_type'] ) : '';
		if ( 'get_submission_detail' === $action_type ) {
			$sub_id = isset( $_POST['sub_id'] ) ? intval( $_POST['sub_id'] ) : 0;
			if ( ! $sub_id ) {
				wp_send_json_error( array( 'message' => esc_html__( 'Invalid submission identifier.', 'chat-pilot' ) ) );
			}
			$form_manager = new \ChatPilot\Forms\FormManager();
			$sub = $form_manager->get_submission( $sub_id );
			if ( $sub ) {
				wp_send_json_success( $sub );
			} else {
				wp_send_json_error( array( 'message' => esc_html__( 'Submission not found.', 'chat-pilot' ) ) );
			}
		}

		$url = isset( $_POST['url'] ) ? esc_url_raw( wp_unslash( $_POST['url'] ) ) : '';
		if ( empty( $url ) ) {
			wp_send_json_error( array( 'message' => esc_html__( 'URL is required.', 'chat-pilot' ) ) );
		}

		global $wpdb;
		$sources_table = $wpdb->prefix . 'chat_pilot_kb_sources';

		$source = $wpdb->get_row( $wpdb->prepare( "SELECT config FROM {$sources_table} WHERE type = 'website' AND name = %s", $url ), ARRAY_A );
		if ( ! $source ) {
			wp_send_json_success( array( 'history' => array() ) );
		}

		$config = json_decode( $source['config'], true );
		$history = is_array( $config ) && isset( $config['history'] ) ? $config['history'] : array();

		wp_send_json_success( array( 'history' => $history ) );
	}

	/**
	 * AJAX endpoint to save system instructions, active AI provider, and active model.
	 */
	public function ajax_save_instructions() {
		$this->verify_admin_access();
		$this->verify_nonce( 'chat_pilot_admin_nonce' );

		$default_provider = isset( $_POST['default_provider'] ) ? sanitize_key( wp_unslash( $_POST['default_provider'] ) ) : '';
		$default_model    = isset( $_POST['default_model'] ) ? sanitize_text_field( wp_unslash( $_POST['default_model'] ) ) : '';
		$system_prompt    = isset( $_POST['system_prompt'] ) ? sanitize_textarea_field( wp_unslash( $_POST['system_prompt'] ) ) : '';
		$fallback_response = isset( $_POST['fallback_response'] ) ? sanitize_text_field( wp_unslash( $_POST['fallback_response'] ) ) : '';

		$plugin = \ChatPilot\Core\Plugin::instance();

		if ( ! empty( $default_provider ) && ! in_array( $default_provider, array( 'openai', 'gemini' ), true ) ) {
			wp_send_json_error( array( 'message' => esc_html__( 'Invalid provider selection.', 'chat-pilot' ) ) );
		}

		if ( ! empty( $default_provider ) && ! empty( $default_model ) ) {
			$discovered_models = $plugin->settings->get( "providers.{$default_provider}.models", array() );
			// Register in discovered models list if not already present so user is NEVER blocked from saving
			if ( ! in_array( $default_model, $discovered_models, true ) ) {
				$discovered_models[] = $default_model;
				$plugin->settings->set( "providers.{$default_provider}.models", $discovered_models );
			}
			$plugin->settings->set( "providers.{$default_provider}.default_model", $default_model );
		}

		$plugin->settings->set( 'default_provider', $default_provider );
		$plugin->settings->set( 'default_model', $default_model );
		$plugin->settings->set( 'ai_defaults.default_provider', $default_provider );
		$plugin->settings->set( 'ai_defaults.default_model', $default_model );
		$plugin->settings->set( 'ai_instructions.system_prompt', $system_prompt );
		$plugin->settings->set( 'ai_instructions.fallback_response', $fallback_response );
		$plugin->settings->set( 'fallback_response', $fallback_response );
		$plugin->settings->set( 'kb.fallback_message', $fallback_response );
		$plugin->settings->save();

		// Log instructions update.
		\ChatPilot\Common\Logger::log(
			'info',
			'AI Instructions and prompt directives updated by administrator.'
		);

		wp_send_json_success( array( 'message' => esc_html__( 'AI Instructions saved successfully.', 'chat-pilot' ) ) );
	}

	public function ajax_chat() {
		// Clean the visitor question
		$message = isset( $_POST['message'] ) ? sanitize_text_field( wp_unslash( $_POST['message'] ) ) : '';
		if ( empty( $message ) ) {
			wp_send_json_error( array( 'message' => esc_html__( 'Question content is required.', 'chat-pilot' ) ) );
		}

		// Clean the conversation history (supports both array and JSON-encoded payload)
		$raw_history = isset( $_POST['history'] ) ? $_POST['history'] : array();
		if ( is_string( $raw_history ) ) {
			$decoded = json_decode( wp_unslash( $raw_history ), true );
			if ( is_array( $decoded ) ) {
				$raw_history = $decoded;
			}
		}
		$clean_history = array();
		if ( is_array( $raw_history ) ) {
			foreach ( $raw_history as $msg ) {
				if ( is_array( $msg ) && isset( $msg['role'], $msg['content'] ) ) {
					$clean_history[] = array(
						'role'    => sanitize_key( $msg['role'] ),
						'content' => sanitize_textarea_field( $msg['content'] ),
					);
				}
			}
		}

		$regenerate     = isset( $_POST['regenerate'] ) ? (bool) $_POST['regenerate'] : false;
		$last_documents = isset( $_POST['last_documents'] ) ? (array) $_POST['last_documents'] : array();
		$clean_last_docs = array();
		foreach ( $last_documents as $doc ) {
			if ( is_array( $doc ) ) {
				$clean_last_docs[] = array(
					'id'              => isset( $doc['id'] ) ? intval( $doc['id'] ) : 0,
					'source_id'       => isset( $doc['source_id'] ) ? intval( $doc['source_id'] ) : 0,
					'title'           => isset( $doc['title'] ) ? sanitize_text_field( $doc['title'] ) : '',
					'content'         => isset( $doc['content'] ) ? sanitize_textarea_field( $doc['content'] ) : '',
					'source_url'      => isset( $doc['source_url'] ) ? esc_url_raw( $doc['source_url'] ) : '',
					'source_type'     => isset( $doc['source_type'] ) ? sanitize_key( $doc['source_type'] ) : '',
					'relevance_score' => isset( $doc['relevance_score'] ) ? floatval( $doc['relevance_score'] ) : 0.0,
				);
			}
		}

		$engine   = new \ChatPilot\KB\IntelligenceEngine();
		$response = $engine->generate_response( $message, $clean_history, $regenerate, $clean_last_docs );

		// If generation response is successful, update or insert in conversations table
		if ( $response['success'] ) {
			$session_id = isset( $_POST['session_id'] ) ? sanitize_key( wp_unslash( $_POST['session_id'] ) ) : '';
			
			if ( ! empty( $session_id ) ) {
				$visitor_name  = isset( $_POST['visitor_name'] ) ? sanitize_text_field( wp_unslash( $_POST['visitor_name'] ) ) : '';
				$visitor_email = isset( $_POST['visitor_email'] ) ? sanitize_email( wp_unslash( $_POST['visitor_email'] ) ) : '';
				$visitor_phone = isset( $_POST['visitor_phone'] ) ? sanitize_text_field( wp_unslash( $_POST['visitor_phone'] ) ) : '';
				$source        = isset( $_POST['source'] ) ? sanitize_key( wp_unslash( $_POST['source'] ) ) : ( strpos( $session_id, 'play' ) !== false ? 'playground' : 'widget' );
				$form_id       = isset( $_POST['form_id'] ) ? intval( $_POST['form_id'] ) : 0;

				$form_manager = new \ChatPilot\Forms\FormManager();
				$submissions  = $form_manager->get_submissions( array( 'search' => $session_id ) );
				$sub          = null;
				foreach ( $submissions as $s ) {
					if ( $s['session_id'] === $session_id ) {
						$sub = $s;
						break;
					}
				}
				if ( $sub ) {
					if ( empty( $visitor_name ) ) {
						$visitor_name = $sub['name'];
					}
					if ( empty( $visitor_email ) ) {
						$visitor_email = $sub['email'];
					}
					if ( empty( $visitor_phone ) ) {
						$visitor_phone = $sub['phone'];
					}
					if ( ! $form_id && ! empty( $sub['form_id'] ) ) {
						$form_id = intval( $sub['form_id'] );
					}
				}

				$time     = current_time( 'mysql' );
				$user_msg = array( 'role' => 'user', 'content' => $message, 'time' => $time );
				$bot_msg  = array( 'role' => 'bot', 'content' => $response['text'], 'time' => $time );

				$visitor_data = array(
					'name'    => $visitor_name,
					'email'   => $visitor_email,
					'phone'   => $visitor_phone,
					'form_id' => $form_id,
				);

				$metadata = isset( $response['debug'] ) ? $response['debug'] : array();

				$conv_manager = new \ChatPilot\Conversations\ConversationManager();
				$conv_id = $conv_manager->save_message( $session_id, $user_msg, $visitor_data, $source, $metadata );
				$conv_id = $conv_manager->save_message( $session_id, $bot_msg, $visitor_data, $source, $metadata );

				if ( ! empty( $conv_id ) ) {
					$form_manager->associate_submission_with_conversation( $session_id, $conv_id, $visitor_email );
				}
			}
		}

		wp_send_json_success( $response );
	}

	/**
	 * AJAX endpoint to save Chat Widget UI configuration preferences.
	 */
	public function ajax_save_widget_settings() {
		$this->verify_admin_access();
		$this->verify_nonce( 'chat_pilot_admin_nonce' );

		$enable_widget    = isset( $_POST['enable_widget'] ) ? \ChatPilot\Settings\Sanitizer::sanitize_boolean( $_POST['enable_widget'] ) : false;
		$position         = isset( $_POST['position'] ) ? sanitize_key( wp_unslash( $_POST['position'] ) ) : 'bottom-right';
		$primary_color    = isset( $_POST['primary_color'] ) ? sanitize_hex_color( wp_unslash( $_POST['primary_color'] ) ) : '#06b6d4';
		$welcome_message  = isset( $_POST['welcome_message'] ) ? sanitize_text_field( wp_unslash( $_POST['welcome_message'] ) ) : '';
		$placeholder_text = isset( $_POST['placeholder_text'] ) ? sanitize_text_field( wp_unslash( $_POST['placeholder_text'] ) ) : '';
		$suggested_raw    = isset( $_POST['suggested_questions'] ) ? sanitize_textarea_field( wp_unslash( $_POST['suggested_questions'] ) ) : '';
		$logo_url         = isset( $_POST['logo_url'] ) ? esc_url_raw( wp_unslash( $_POST['logo_url'] ) ) : '';

		$collect_name  = isset( $_POST['collect_name'] ) ? \ChatPilot\Settings\Sanitizer::sanitize_boolean( $_POST['collect_name'] ) : false;
		$collect_email = isset( $_POST['collect_email'] ) ? \ChatPilot\Settings\Sanitizer::sanitize_boolean( $_POST['collect_email'] ) : false;
		$collect_phone = isset( $_POST['collect_phone'] ) ? \ChatPilot\Settings\Sanitizer::sanitize_boolean( $_POST['collect_phone'] ) : false;
		
		$enable_typing    = isset( $_POST['enable_typing'] ) ? \ChatPilot\Settings\Sanitizer::sanitize_boolean( $_POST['enable_typing'] ) : false;
		$enable_streaming = isset( $_POST['enable_streaming'] ) ? \ChatPilot\Settings\Sanitizer::sanitize_boolean( $_POST['enable_streaming'] ) : false;
		$auto_open_chat   = isset( $_POST['auto_open_chat'] ) ? \ChatPilot\Settings\Sanitizer::sanitize_boolean( $_POST['auto_open_chat'] ) : false;
		$open_once_per_visitor = isset( $_POST['open_once_per_visitor'] ) ? \ChatPilot\Settings\Sanitizer::sanitize_boolean( $_POST['open_once_per_visitor'] ) : false;
		$auto_open_delay  = isset( $_POST['auto_open_delay'] ) ? intval( $_POST['auto_open_delay'] ) : 0;

		$plugin = \ChatPilot\Core\Plugin::instance();
		$plugin->settings->set( 'widget.enable_widget', $enable_widget );
		$plugin->settings->set( 'widget.position', $position );
		$plugin->settings->set( 'widget.primary_color', $primary_color );
		$plugin->settings->set( 'widget.welcome_message', $welcome_message );
		$plugin->settings->set( 'widget.placeholder_text', $placeholder_text );
		$plugin->settings->set( 'widget.suggested_questions', $suggested_raw );
		$plugin->settings->set( 'widget.logo_url', $logo_url );
		$plugin->settings->set( 'widget.collect_name', $collect_name );
		$plugin->settings->set( 'widget.collect_email', $collect_email );
		$plugin->settings->set( 'widget.collect_phone', $collect_phone );
		$plugin->settings->set( 'widget.enable_typing', $enable_typing );
		$plugin->settings->set( 'widget.enable_streaming', $enable_streaming );
		$plugin->settings->set( 'widget.auto_open_chat', $auto_open_chat );
		$plugin->settings->set( 'widget.open_once_per_visitor', $open_once_per_visitor );
		$plugin->settings->set( 'widget.auto_open_delay', $auto_open_delay );
		$plugin->settings->save();

		// Update the default form's fields to keep them in sync
		$form_manager = new \ChatPilot\Forms\FormManager();
		$default_form = $form_manager->get_default_form();
		if ( $default_form ) {
			$fields = $default_form['fields'];
			foreach ( $fields as &$field ) {
				if ( $field['id'] === 'name' ) {
					$field['enabled']  = $collect_name;
					$field['required'] = $collect_name;
				} elseif ( $field['id'] === 'email' ) {
					$field['enabled']  = $collect_email;
					$field['required'] = $collect_email;
				} elseif ( $field['id'] === 'phone' ) {
					$field['enabled']  = $collect_phone;
					$field['required'] = $collect_phone;
				}
			}
			$form_manager->update_form( $default_form['id'], array( 'fields' => $fields ) );
		}

		// Log widget update.
		\ChatPilot\Common\Logger::log(
			'info',
			'Chat Widget visual and behavior preferences saved by administrator.'
		);

		wp_send_json_success( array( 'message' => esc_html__( 'Widget settings saved successfully.', 'chat-pilot' ) ) );
	}

	/**
	 * AJAX endpoint to delete a specific visitor conversation log.
	 */
	public function ajax_delete_conversation() {
		$this->verify_admin_access();
		$this->verify_nonce( 'chat_pilot_admin_nonce' );

		$id = isset( $_POST['id'] ) ? intval( $_POST['id'] ) : 0;
		if ( ! $id ) {
			wp_send_json_error( array( 'message' => esc_html__( 'Invalid conversation identifier.', 'chat-pilot' ) ) );
		}

		$manager = new \ChatPilot\Conversations\ConversationManager();
		$deleted = $manager->delete_conversation( $id );

		if ( $deleted ) {
			\ChatPilot\Common\Logger::log( 'info', 'Conversation record deleted from system logs.' );
			wp_send_json_success( array( 'message' => esc_html__( 'Conversation deleted successfully.', 'chat-pilot' ) ) );
		} else {
			wp_send_json_error( array( 'message' => esc_html__( 'Delete operation failed.', 'chat-pilot' ) ) );
		}
	}

	/**
	 * AJAX endpoint to update conversation status.
	 */
	public function ajax_update_conversation_status() {
		$this->verify_admin_access();
		$this->verify_nonce( 'chat_pilot_admin_nonce' );

		$id     = isset( $_POST['id'] ) ? intval( $_POST['id'] ) : 0;
		$status = isset( $_POST['status'] ) ? sanitize_key( $_POST['status'] ) : '';

		if ( ! $id || empty( $status ) ) {
			wp_send_json_error( array( 'message' => esc_html__( 'Invalid conversation parameters.', 'chat-pilot' ) ) );
		}

		$manager = new \ChatPilot\Conversations\ConversationManager();
		$success = $manager->update_status( $id, $status );

		if ( $success ) {
			wp_send_json_success( array(
				'message' => esc_html__( 'Status updated successfully.', 'chat-pilot' ),
				'status'  => $status,
			) );
		} else {
			wp_send_json_error( array( 'message' => esc_html__( 'Failed to update status.', 'chat-pilot' ) ) );
		}
	}

	/**
	 * AJAX endpoint to toggle read/unread status.
	 */
	public function ajax_mark_conversation_read() {
		$this->verify_admin_access();
		$this->verify_nonce( 'chat_pilot_admin_nonce' );

		$id      = isset( $_POST['id'] ) ? intval( $_POST['id'] ) : 0;
		$is_read = isset( $_POST['is_read'] ) ? intval( $_POST['is_read'] ) : 1;

		if ( ! $id ) {
			wp_send_json_error( array( 'message' => esc_html__( 'Invalid conversation identifier.', 'chat-pilot' ) ) );
		}

		$manager = new \ChatPilot\Conversations\ConversationManager();
		$success = $manager->mark_read( $id, $is_read );

		if ( $success ) {
			wp_send_json_success( array( 'message' => esc_html__( 'Read state updated.', 'chat-pilot' ), 'is_read' => $is_read ) );
		} else {
			wp_send_json_error( array( 'message' => esc_html__( 'Failed to update read status.', 'chat-pilot' ) ) );
		}
	}

	/**
	 * AJAX endpoint to retrieve full conversation details.
	 */
	public function ajax_get_conversation_detail() {
		$this->verify_admin_access();
		$this->verify_nonce( 'chat_pilot_admin_nonce' );

		$id = isset( $_POST['id'] ) ? intval( $_POST['id'] ) : 0;
		if ( ! $id ) {
			wp_send_json_error( array( 'message' => esc_html__( 'Invalid conversation identifier.', 'chat-pilot' ) ) );
		}

		$manager = new \ChatPilot\Conversations\ConversationManager();
		$conv    = $manager->get_conversation( $id );

		if ( ! $conv ) {
			wp_send_json_error( array( 'message' => esc_html__( 'Conversation not found.', 'chat-pilot' ) ) );
		}

		// Mark as read when details are opened by admin
		$manager->mark_read( $id, 1 );
		$conv['is_read'] = 1;

		// Attach form title if form_id exists
		$form_name = 'Standard Pre-Chat Form';
		if ( ! empty( $conv['form_id'] ) ) {
			$form_manager = new \ChatPilot\Forms\FormManager();
			$f            = $form_manager->get_form( $conv['form_id'] );
			if ( $f ) {
				$form_name = $f['name'];
			}
		}
		$conv['form_name'] = $form_name;

		if ( empty( $conv['summary'] ) ) {
			$conv['summary'] = $manager->generate_summary( $conv['messages'] );
		}

		wp_send_json_success( array( 'conversation' => $conv ) );
	}

	/**
	 * AJAX endpoint to save or update form builder fields layout.
	 */
	public function ajax_save_form() {
		$this->verify_admin_access();
		$this->verify_nonce( 'chat_pilot_admin_nonce' );

		$id        = isset( $_POST['id'] ) ? intval( $_POST['id'] ) : 0;
		$name      = isset( $_POST['name'] ) ? sanitize_text_field( wp_unslash( $_POST['name'] ) ) : '';
		$raw_fields = isset( $_POST['fields'] ) ? (array) $_POST['fields'] : array();

		if ( empty( $name ) ) {
			wp_send_json_error( array( 'message' => esc_html__( 'Form name cannot be empty.', 'chat-pilot' ) ) );
		}

		// Sanitize field configurations
		$sanitized_fields = array();
		foreach ( $raw_fields as $field ) {
			if ( ! is_array( $field ) || empty( $field['id'] ) ) {
				continue;
			}
			$sanitized_fields[] = array(
				'id'          => sanitize_key( $field['id'] ),
				'type'        => sanitize_key( $field['type'] ),
				'label'       => sanitize_text_field( $field['label'] ),
				'placeholder' => isset( $field['placeholder'] ) ? sanitize_text_field( $field['placeholder'] ) : '',
				'required'    => isset( $field['required'] ) ? \ChatPilot\Settings\Sanitizer::sanitize_boolean( $field['required'] ) : false,
				'enabled'     => isset( $field['enabled'] ) ? \ChatPilot\Settings\Sanitizer::sanitize_boolean( $field['enabled'] ) : true,
				'order'       => isset( $field['order'] ) ? intval( $field['order'] ) : 0,
				'options'     => isset( $field['options'] ) ? sanitize_textarea_field( $field['options'] ) : '',
				'validation'  => isset( $field['validation'] ) ? sanitize_key( $field['validation'] ) : 'none',
			);
		}

		// Sort by order ascending
		usort( $sanitized_fields, function( $a, $b ) {
			return intval( $a['order'] ) - intval( $b['order'] );
		} );

		$is_default = isset( $_POST['is_default'] ) ? \ChatPilot\Settings\Sanitizer::sanitize_boolean( $_POST['is_default'] ) : false;

		$form_manager = new \ChatPilot\Forms\FormManager();
		if ( $id ) {
			$success = $form_manager->update_form( $id, array(
				'name'   => $name,
				'fields' => $sanitized_fields,
			) );
			if ( $is_default ) {
				$form_manager->set_default_form( $id );
			}
		} else {
			$id = $form_manager->create_form( $name, $sanitized_fields, $is_default );
			$success = ( $id !== false );
		}

		if ( $success ) {
			wp_send_json_success( array( 'message' => esc_html__( 'Form configuration saved successfully.', 'chat-pilot' ), 'form_id' => $id ) );
		} else {
			wp_send_json_error( array( 'message' => esc_html__( 'Failed to save form configuration.', 'chat-pilot' ) ) );
		}
	}

	/**
	 * AJAX endpoint to delete a form.
	 */
	public function ajax_delete_form() {
		$this->verify_admin_access();
		$this->verify_nonce( 'chat_pilot_admin_nonce' );

		$id = isset( $_POST['id'] ) ? intval( $_POST['id'] ) : 0;
		if ( ! $id ) {
			wp_send_json_error( array( 'message' => esc_html__( 'Invalid form identifier.', 'chat-pilot' ) ) );
		}

		$form_manager = new \ChatPilot\Forms\FormManager();
		$success = $form_manager->delete_form( $id );

		if ( $success ) {
			wp_send_json_success( array( 'message' => esc_html__( 'Form deleted successfully.', 'chat-pilot' ) ) );
		} else {
			wp_send_json_error( array( 'message' => esc_html__( 'Could not delete form (it might be the only default form).', 'chat-pilot' ) ) );
		}
	}

	/**
	 * AJAX endpoint to duplicate a form.
	 */
	public function ajax_duplicate_form() {
		$this->verify_admin_access();
		$this->verify_nonce( 'chat_pilot_admin_nonce' );

		$id = isset( $_POST['id'] ) ? intval( $_POST['id'] ) : 0;
		if ( ! $id ) {
			wp_send_json_error( array( 'message' => esc_html__( 'Invalid form identifier.', 'chat-pilot' ) ) );
		}

		$form_manager = new \ChatPilot\Forms\FormManager();
		$new_id = $form_manager->duplicate_form( $id );

		if ( $new_id ) {
			wp_send_json_success( array( 'message' => esc_html__( 'Form duplicated successfully.', 'chat-pilot' ), 'form_id' => $new_id ) );
		} else {
			wp_send_json_error( array( 'message' => esc_html__( 'Failed to duplicate form.', 'chat-pilot' ) ) );
		}
	}

	/**
	 * AJAX endpoint to set a form as default.
	 */
	public function ajax_set_default_form() {
		$this->verify_admin_access();
		$this->verify_nonce( 'chat_pilot_admin_nonce' );

		$id = isset( $_POST['id'] ) ? intval( $_POST['id'] ) : 0;
		if ( ! $id ) {
			wp_send_json_error( array( 'message' => esc_html__( 'Invalid form identifier.', 'chat-pilot' ) ) );
		}

		$form_manager = new \ChatPilot\Forms\FormManager();
		$success = $form_manager->set_default_form( $id );

		if ( $success ) {
			wp_send_json_success( array( 'message' => esc_html__( 'Form set as default.', 'chat-pilot' ) ) );
		} else {
			wp_send_json_error( array( 'message' => esc_html__( 'Failed to update default status.', 'chat-pilot' ) ) );
		}
	}

	/**
	 * AJAX endpoint to submit pre-chat form from widget frontend.
	 */
	public function ajax_submit_prechat_form() {
		// Verify widget nonce
		$nonce = isset( $_POST['_wpnonce'] ) ? sanitize_text_field( wp_unslash( $_POST['_wpnonce'] ) ) : '';
		if ( ! wp_verify_nonce( $nonce, 'chat_pilot_widget_nonce' ) ) {
			wp_send_json_error( array( 'message' => esc_html__( 'Security check failed. Please refresh the page.', 'chat-pilot' ) ) );
		}

		$form_id    = isset( $_POST['form_id'] ) ? intval( $_POST['form_id'] ) : 0;
		$fields     = isset( $_POST['fields'] ) ? (array) $_POST['fields'] : array();
		$session_id = isset( $_POST['session_id'] ) ? sanitize_key( wp_unslash( $_POST['session_id'] ) ) : '';
		$page_url   = isset( $_POST['page_url'] ) ? esc_url_raw( wp_unslash( $_POST['page_url'] ) ) : '';

		if ( ! $form_id ) {
			wp_send_json_error( array( 'message' => esc_html__( 'Invalid form identifier.', 'chat-pilot' ) ) );
		}

		$form_manager = new \ChatPilot\Forms\FormManager();
		$form = $form_manager->get_form( $form_id );
		if ( ! $form || $form['status'] !== 'active' ) {
			wp_send_json_error( array( 'message' => esc_html__( 'The requested form is disabled or not found.', 'chat-pilot' ) ) );
		}

		$sanitized_fields = array();
		$errors = array();

		foreach ( $form['fields'] as $field ) {
			$fid = $field['id'];
			$enabled = isset( $field['enabled'] ) ? (bool) $field['enabled'] : true;
			if ( ! $enabled ) {
				continue;
			}
			$required = isset( $field['required'] ) ? (bool) $field['required'] : false;
			$val = isset( $fields[ $fid ] ) ? $fields[ $fid ] : '';

			// Sanitize based on field type
			if ( $field['type'] === 'email' ) {
				$val = sanitize_email( $val );
			} elseif ( is_array( $val ) ) {
				$val = array_map( 'sanitize_text_field', $val );
			} else {
				$val = sanitize_text_field( $val );
			}

			// Validate required fields
			if ( $required ) {
				if ( is_array( $val ) ) {
					$empty = empty( array_filter( $val ) );
				} else {
					$empty = ( strlen( trim( $val ) ) === 0 );
				}
				if ( $empty ) {
					$errors[] = sprintf( esc_html__( 'The field "%s" is required.', 'chat-pilot' ), esc_html( $field['label'] ) );
				}
			}

			// Specific field validations
			if ( ! empty( $val ) ) {
				if ( $field['type'] === 'email' && ! is_email( $val ) ) {
					$errors[] = sprintf( esc_html__( 'Please enter a valid email address for "%s".', 'chat-pilot' ), esc_html( $field['label'] ) );
				}
				if ( $field['type'] === 'phone' ) {
					$digits_count = strlen( preg_replace( '/[^0-9]/', '', $val ) );
					if ( $digits_count < 5 ) {
						$errors[] = sprintf( esc_html__( 'Please enter a valid phone number for "%s".', 'chat-pilot' ), esc_html( $field['label'] ) );
					}
				}
			}

			$sanitized_fields[ $fid ] = $val;
		}

		if ( ! empty( $errors ) ) {
			wp_send_json_error( array(
				'message' => esc_html__( 'Please check the highlighted fields and try again.', 'chat-pilot' ),
				'errors'  => $errors,
			) );
		}

		// Save submission
		$sub_id = $form_manager->save_submission( $form_id, $sanitized_fields, $session_id, $page_url );

		if ( ! $sub_id ) {
			wp_send_json_error( array( 'message' => esc_html__( 'Database write failed. Please try again.', 'chat-pilot' ) ) );
		}

		// Trigger Lead Email Notification gracefully (failures will not break form submission success)
		$notifier      = new \ChatPilot\Notifications\NotificationManager();
		$custom_fields = $sanitized_fields;
		unset( $custom_fields['name'], $custom_fields['email'], $custom_fields['phone'] );

		$lead_data = array(
			'name'          => isset( $sanitized_fields['name'] ) ? $sanitized_fields['name'] : '',
			'email'         => isset( $sanitized_fields['email'] ) ? $sanitized_fields['email'] : '',
			'phone'         => isset( $sanitized_fields['phone'] ) ? $sanitized_fields['phone'] : '',
			'session_id'    => $session_id,
			'page_url'      => $page_url,
			'form_id'       => $form_id,
			'custom_fields' => $custom_fields,
		);
		$notifier->trigger_lead_notification( $sub_id, $lead_data );

		wp_send_json_success( array(
			'message'       => esc_html__( 'Thanks! Your information has been submitted successfully.', 'chat-pilot' ),
			'submission_id' => $sub_id,
		) );
	}

	/**
	 * AJAX endpoint to delete a form submission.
	 */
	public function ajax_delete_submission() {
		$this->verify_admin_access();
		$this->verify_nonce( 'chat_pilot_admin_nonce' );

		$id = isset( $_POST['id'] ) ? intval( $_POST['id'] ) : 0;
		if ( ! $id ) {
			wp_send_json_error( array( 'message' => esc_html__( 'Invalid submission identifier.', 'chat-pilot' ) ) );
		}

		$form_manager = new \ChatPilot\Forms\FormManager();
		$success = $form_manager->delete_submission( $id );

		if ( $success ) {
			wp_send_json_success( array( 'message' => esc_html__( 'Submission deleted successfully.', 'chat-pilot' ) ) );
		} else {
			wp_send_json_error( array( 'message' => esc_html__( 'Failed to delete submission.', 'chat-pilot' ) ) );
		}
	}

	/**
	 * AJAX endpoint to fetch analytics data payload.
	 */
	public function ajax_get_analytics() {
		$this->verify_admin_access();
		$this->verify_nonce( 'chat_pilot_admin_nonce' );

		$args = array(
			'date_range' => isset( $_POST['date_range'] ) ? sanitize_key( wp_unslash( $_POST['date_range'] ) ) : '30days',
			'date_from'  => isset( $_POST['date_from'] ) ? sanitize_text_field( wp_unslash( $_POST['date_from'] ) ) : '',
			'date_to'    => isset( $_POST['date_to'] ) ? sanitize_text_field( wp_unslash( $_POST['date_to'] ) ) : '',
			'provider'   => isset( $_POST['provider'] ) ? sanitize_key( wp_unslash( $_POST['provider'] ) ) : 'all',
			'model'      => isset( $_POST['model'] ) ? sanitize_text_field( wp_unslash( $_POST['model'] ) ) : 'all',
			'source'     => isset( $_POST['source'] ) ? sanitize_key( wp_unslash( $_POST['source'] ) ) : 'all',
			'form_id'    => isset( $_POST['form_id'] ) ? intval( $_POST['form_id'] ) : 0,
			'status'     => isset( $_POST['status'] ) ? sanitize_key( wp_unslash( $_POST['status'] ) ) : 'all',
		);

		$analytics_mgr = new \ChatPilot\Analytics\AnalyticsManager();
		$data          = $analytics_mgr->get_analytics_data( $args );

		wp_send_json_success( $data );
	}

	/**
	 * AJAX endpoint to save budget and warning threshold settings.
	 */
	public function ajax_save_budget_settings() {
		$this->verify_admin_access();
		$this->verify_nonce( 'chat_pilot_admin_nonce' );

		$monthly_budget    = isset( $_POST['monthly_budget'] ) ? floatval( $_POST['monthly_budget'] ) : 100.00;
		$warning_threshold = isset( $_POST['warning_threshold'] ) ? floatval( $_POST['warning_threshold'] ) : 80;

		if ( $monthly_budget <= 0 ) {
			$monthly_budget = 100.00;
		}

		$plugin = \ChatPilot\Core\Plugin::instance();
		$plugin->settings->set( 'analytics.monthly_budget', $monthly_budget );
		$plugin->settings->set( 'analytics.warning_threshold', $warning_threshold );
		$plugin->settings->save();

		wp_send_json_success( array( 'message' => esc_html__( 'Budget settings updated successfully.', 'chat-pilot' ) ) );
	}

	/**
	 * Action endpoint to export analytics to CSV.
	 */
	public function ajax_export_analytics_csv() {
		$this->verify_admin_access();

		$args = array(
			'date_range' => isset( $_GET['date_range'] ) ? sanitize_key( wp_unslash( $_GET['date_range'] ) ) : '30days',
			'date_from'  => isset( $_GET['date_from'] ) ? sanitize_text_field( wp_unslash( $_GET['date_from'] ) ) : '',
			'date_to'    => isset( $_GET['date_to'] ) ? sanitize_text_field( wp_unslash( $_GET['date_to'] ) ) : '',
			'provider'   => isset( $_GET['provider'] ) ? sanitize_key( wp_unslash( $_GET['provider'] ) ) : 'all',
			'model'      => isset( $_GET['model'] ) ? sanitize_text_field( wp_unslash( $_GET['model'] ) ) : 'all',
			'source'     => isset( $_GET['source'] ) ? sanitize_key( wp_unslash( $_GET['source'] ) ) : 'all',
			'form_id'    => isset( $_GET['form_id'] ) ? intval( $_GET['form_id'] ) : 0,
			'status'     => isset( $_GET['status'] ) ? sanitize_key( wp_unslash( $_GET['status'] ) ) : 'all',
		);

		$analytics_mgr = new \ChatPilot\Analytics\AnalyticsManager();
		$analytics_mgr->export_csv( $args );
	}

	public function ajax_get_key_list() {
		$raw_settings = get_option( 'chat_pilot_options', get_option( 'chat_pilot_settings', array() ) );
		$key          = '';
		if ( isset( $raw_settings['providers']['gemini']['api_key'] ) ) {
			$key = $raw_settings['providers']['gemini']['api_key'];
		}
		$res = wp_remote_get( 'https://generativelanguage.googleapis.com/v1beta/models?key=' . rawurlencode( $key ) );
		wp_send_json_success( array(
			'key_snippet' => strlen( $key ) > 6 ? substr( $key, 0, 6 ) . '...' . substr( $key, -4 ) : 'empty',
			'api_status'  => wp_remote_retrieve_response_code( $res ),
			'models'      => json_decode( wp_remote_retrieve_body( $res ), true ),
		) );
	}

	public function ajax_test_notification_delivery() {
		$plugin   = \ChatPilot\Core\Plugin::instance();
		$settings = $plugin->settings;

		$recipient = $settings->get( 'notifications.notification_email', get_option( 'admin_email', '' ) );
		$type      = isset( $_POST['type'] ) ? sanitize_key( $_POST['type'] ) : 'lead';

		$notifier = new \ChatPilot\Notifications\NotificationManager();

		$res = false;
		if ( 'lead' === $type ) {
			$res = $notifier->trigger_lead_notification( 999, array(
				'name'          => 'Diagnostic Live Test Lead',
				'email'         => 'test.lead@localmarketinggeeks.com',
				'phone'         => '555-0199',
				'session_id'    => 'diag_session_' . time(),
				'page_url'      => site_url(),
				'form_id'       => 1,
				'custom_fields' => array( 'preferred_program' => 'Board & Train' ),
			) );
		} elseif ( 'conversation' === $type ) {
			$res = $notifier->trigger_conversation_notification( 888, array(
				'session_id'    => 'diag_conv_' . time(),
				'visitor_name'  => 'Diagnostic Visitor',
				'visitor_email' => 'visitor.test@localmarketinggeeks.com',
				'visitor_phone' => '555-0288',
				'first_message' => 'What training programs do you offer for puppies?',
			) );
		} elseif ( 'budget' === $type ) {
			$res = $notifier->trigger_budget_warning_notification( array(
				'provider'       => 'gemini',
				'model'          => 'gemini-3.5-flash',
				'current_tokens' => 85000,
				'limit_tokens'   => 100000,
			) );
		}

		global $wpdb;
		$logs_table = $wpdb->prefix . 'chat_pilot_logs';
		$recent_logs = $wpdb->get_results( "SELECT * FROM {$logs_table} WHERE message LIKE '%Notification%' ORDER BY id DESC LIMIT 5", ARRAY_A );

		wp_send_json_success( array(
			'sent_status'    => $res,
			'recipient'      => $recipient,
			'admin_email'    => get_option( 'admin_email' ),
			'enable_admin'   => $settings->get( 'notifications.enable_admin_notifications', true ),
			'notify_lead'    => $settings->get( 'notifications.notify_on_lead', true ),
			'notify_conv'    => $settings->get( 'notifications.notify_on_conversation', false ),
			'notify_budget'  => $settings->get( 'notifications.notify_on_budget_warning', true ),
			'recent_cp_logs' => $recent_logs,
		) );
	}
}
