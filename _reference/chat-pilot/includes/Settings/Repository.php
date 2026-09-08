<?php
namespace ChatPilot\Settings;

// Prevent direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class Repository
 * Manages database options persistence using a single array-mapped options tree.
 */
class Repository {

	/**
	 * Options storage array.
	 *
	 * @var array
	 */
	private $options = array();

	/**
	 * WordPress database option key name.
	 *
	 * @var string
	 */
	private $option_name = 'chat_pilot_options';

	/**
	 * Constructor. Loads settings from database.
	 */
	public function __construct() {
		$this->load();
	}

	/**
	 * Loads options from WordPress database.
	 */
	private function load() {
		$this->options = get_option( $this->option_name, array() );
	}

	/**
	 * Predefined default settings schema.
	 *
	 * @return array Multi-dimensional default options array.
	 */
	public function get_defaults() {
		return array(
			'general'  => array(
				'plugin_name'         => 'Chat Pilot',
				'enable_plugin'       => true,
				'default_language'    => 'en',
				'timezone_mode'       => 'site',
				'dev_mode'            => false,
				'debug_mode'          => false,
				'enable_logging'      => true,
				'delete_on_uninstall' => false,
			),
			'ai_defaults' => array(
				'default_provider'          => 'gemini',
				'default_model'             => 'gemini-3.6-flash',
			),
			'conversations' => array(
				'inactivity_timeout'        => 30, // minutes
				'retention_days'            => 90, // days (0 = keep forever)
				'max_history_messages'      => 20, // max context messages
				'default_status'            => 'active',
			),
			'privacy' => array(
				'store_conversations'       => true,
				'store_visitor_info'        => true,
				'data_retention_days'       => 90,
				'delete_on_uninstall'       => false,
				'anonymize_ips'             => true,
			),
			'notifications' => array(
				'enable_admin_notifications'=> true,
				'notify_on_lead'            => true,
				'notify_on_conversation'    => true,
				'notification_email'        => get_option( 'admin_email', '' ),
				'notify_on_budget_warning'  => true,
			),
			'performance' => array(
				'logging_level'             => 'info',
				'enable_logging'            => true,
				'cache_ttl'                 => 3600,
			),
			'security' => array(
				'required_capability'       => 'manage_options',
				'mask_sensitive_logs'       => true,
				'strict_nonce_verification' => true,
			),
			'developer' => array(
				'dev_mode'                  => false,
				'debug_mode'                => false,
				'unminified_scripts'        => false,
			),
			'api_keys' => array(
				'openai' => '',
				'gemini' => '',
			),
			'providers' => array(
				'openai' => array(
					'enabled'       => false,
					'api_key'       => '',
					'org_id'        => '',
					'base_url'      => 'https://api.openai.com/v1',
					'default_model' => '',
					'models'        => array(),
					'status'        => 'disconnected',
					'last_success'  => '',
					'last_failure'  => '',
					'response_time' => 0.0,
					'error_count'   => 0,
				),
				'gemini' => array(
					'enabled'       => false,
					'api_key'       => '',
					'default_model' => '',
					'models'        => array(),
					'status'        => 'disconnected',
					'last_success'  => '',
					'last_failure'  => '',
					'response_time' => 0.0,
					'error_count'   => 0,
				),
			),
			'default_provider' => 'gemini',
			'default_model'    => 'gemini-3.6-flash',
			'knowledge_base' => array(
				'retrieval_threshold' => 3.0,
			),
			'ai_instructions' => array(
				'system_prompt'     => "You are Chat Pilot, a helpful AI assistant for our business. Answer questions politely, concisely, and professionally based ONLY on the retrieved knowledge provided. Never invent pricing, policies, services, or facts not present in the context. If you do not know the answer, respond with the fallback message.",
				'fallback_response' => "I couldn't find information about that. Please contact our team for additional assistance.",
			),
			'widget' => array(
				'enable_widget'         => true,
				'position'              => 'bottom-right',
				'primary_color'         => '#06b6d4',
				'welcome_message'       => 'Hi there! How can I help you today?',
				'placeholder_text'      => 'Ask a question...',
				'suggested_questions'   => "What services do you provide?\nWhat areas do you serve?\nDo you offer military discounts?",
				'collect_name'          => false,
				'collect_email'         => false,
				'collect_phone'         => false,
				'enable_typing'         => true,
				'enable_streaming'      => true,
				'auto_open_chat'        => true,
				'open_once_per_visitor'   => true,
				'auto_open_delay'       => 5,
				'logo_url'              => '',
			),
			'system'   => array(
				'db_version'            => '1.0.0',
				'last_resync_timestamp' => '',
				'last_cleanup_timestamp'=> '',
			),
		);
	}

	/**
	 * Seeds initial configuration maps on activation or bootstrap reset.
	 */
	public function initialize_defaults() {
		$defaults = $this->get_defaults();
		if ( empty( $this->options ) ) {
			$this->options = $defaults;
			update_option( $this->option_name, $this->options );
		} else {
			// Deep merge recursive to ensure new default keys are loaded without wiping user custom edits.
			$this->options = $this->array_merge_recursive_distinct( $defaults, $this->options );
			update_option( $this->option_name, $this->options );
		}
	}

	/**
	 * Retrieves an option value using dot notation (e.g. "general.dev_mode").
	 *
	 * @param string $path    Dot-separated settings path key.
	 * @param mixed  $default Default value if path element is missing.
	 * @return mixed Found configuration value or default parameters.
	 */
	public function get( $path, $default = null ) {
		$keys    = explode( '.', $path );
		$current = $this->options;

		foreach ( $keys as $key ) {
			if ( is_array( $current ) && array_key_exists( $key, $current ) ) {
				$current = $current[ $key ];
			} else {
				return $this->get_default_value( $path, $default );
			}
		}

		return $current;
	}

	/**
	 * Sets/Updates an option value using dot notation.
	 *
	 * @param string $path  Dot-separated settings path key.
	 * @param mixed  $value New parameter settings value.
	 */
	public function set( $path, $value ) {
		$keys  = explode( '.', $path );
		$count = count( $keys );
		$loc   = &$this->options;

		for ( $i = 0; $i < $count - 1; $i++ ) {
			$key = $keys[ $i ];
			if ( ! isset( $loc[ $key ] ) || ! is_array( $loc[ $key ] ) ) {
				$loc[ $key ] = array();
			}
			$loc = &$loc[ $key ];
		}

		$loc[ $keys[ $count - 1 ] ] = $value;
	}

	/**
	 * Persists options memory back to database.
	 *
	 * @return bool True if value updated, false otherwise.
	 */
	public function save() {
		return update_option( $this->option_name, $this->options );
	}

	/**
	 * Resets all settings to factory default.
	 */
	public function reset_all() {
		$this->options = $this->get_defaults();
		return $this->save();
	}

	/**
	 * Retrieves default parameters for a dot notation path fallback.
	 *
	 * @param string $path    Dot-separated settings path key.
	 * @param mixed  $default Outer default fallback parameter.
	 * @return mixed Default settings element.
	 */
	private function get_default_value( $path, $default ) {
		$keys    = explode( '.', $path );
		$current = $this->get_defaults();

		foreach ( $keys as $key ) {
			if ( is_array( $current ) && array_key_exists( $key, $current ) ) {
				$current = $current[ $key ];
			} else {
				return $default;
			}
		}

		return $current;
	}

	/**
	 * Helper function to merge array elements keeping distinct structures.
	 */
	private function array_merge_recursive_distinct( array &$array1, array &$array2 ) {
		$merged = $array1;
		foreach ( $array2 as $key => &$value ) {
			if ( is_array( $value ) && isset( $merged[ $key ] ) && is_array( $merged[ $key ] ) ) {
				$merged[ $key ] = $this->array_merge_recursive_distinct( $merged[ $key ], $value );
			} else {
				$merged[ $key ] = $value;
			}
		}
		return $merged;
	}
}
