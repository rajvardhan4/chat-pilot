<?php
namespace ChatPilot\Settings;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class Repository
 * Local plugin settings, stored as one option tree.
 *
 * Scope note: this holds ONLY WordPress-side concerns - whether the plugin is
 * enabled on this site, where the widget may appear, logging, and developer
 * conveniences. Everything that shapes an answer (provider, model, knowledge,
 * instructions, widget appearance, forms) lives in Chat Pilot Cloud, so it can
 * never drift between the two systems.
 *
 * The dot-notation get/set API is kept identical to v1 so existing code and
 * habits carry over.
 */
class Repository {

	/**
	 * In-memory options tree.
	 *
	 * @var array
	 */
	private $options = array();

	/**
	 * Option name.
	 *
	 * @var string
	 */
	private $option_name = 'chat_pilot_options';

	/**
	 * Loads options on construction.
	 */
	public function __construct() {
		$loaded        = get_option( $this->option_name, array() );
		$this->options = is_array( $loaded ) ? $loaded : array();
	}

	/**
	 * Default settings tree.
	 *
	 * @return array
	 */
	public function get_defaults() {
		return array(
			'general' => array(
				'enable_plugin' => true,
			),
			'cloud'   => array(
				// Where this site talks to Chat Pilot Cloud. Empty means the
				// build-time default (or the CHAT_PILOT_API_URL constant, which
				// always wins so a wp-config.php pin cannot be edited away from
				// the admin screen).
				'api_url' => '',
			),
			'display' => array(
				// 'all' | 'exclude' | 'include'
				'mode'          => 'all',
				// Comma-separated post IDs or paths, used by the two modes above.
				'rules'         => '',
				'hide_for_admins' => false,
			),
			'logging' => array(
				'enabled' => true,
			),
			'developer' => array(
				'dev_mode'           => false,
				'unminified_scripts' => false,
			),
			'system' => array(
				'plugin_version' => CHAT_PILOT_VERSION,
			),
		);
	}

	/**
	 * Seeds defaults without clobbering existing values.
	 */
	public function initialize_defaults() {
		$defaults = $this->get_defaults();

		if ( empty( $this->options ) ) {
			$this->options = $defaults;
		} else {
			$this->options = $this->merge_distinct( $defaults, $this->options );
		}

		$this->set( 'system.plugin_version', CHAT_PILOT_VERSION );
		$this->save();
	}

	/**
	 * Reads a value by dot path.
	 *
	 * @param string $path    Dot-separated path.
	 * @param mixed  $default Fallback.
	 * @return mixed
	 */
	public function get( $path, $default = null ) {
		$current = $this->options;
		foreach ( explode( '.', $path ) as $key ) {
			if ( is_array( $current ) && array_key_exists( $key, $current ) ) {
				$current = $current[ $key ];
			} else {
				return $this->default_for( $path, $default );
			}
		}
		return $current;
	}

	/**
	 * Writes a value by dot path.
	 *
	 * @param string $path  Dot-separated path.
	 * @param mixed  $value Value.
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
	 * Persists the tree.
	 *
	 * @return bool
	 */
	public function save() {
		return update_option( $this->option_name, $this->options );
	}

	/**
	 * Restores factory defaults.
	 *
	 * @return bool
	 */
	public function reset_all() {
		$this->options = $this->get_defaults();
		return $this->save();
	}

	/**
	 * Looks up a default for a dot path.
	 *
	 * @param string $path    Dot path.
	 * @param mixed  $default Outer fallback.
	 * @return mixed
	 */
	private function default_for( $path, $default ) {
		$current = $this->get_defaults();
		foreach ( explode( '.', $path ) as $key ) {
			if ( is_array( $current ) && array_key_exists( $key, $current ) ) {
				$current = $current[ $key ];
			} else {
				return $default;
			}
		}
		return $current;
	}

	/**
	 * Recursive merge that lets stored values win over defaults.
	 *
	 * @param array $defaults Defaults.
	 * @param array $stored   Stored values.
	 * @return array
	 */
	private function merge_distinct( array $defaults, array $stored ) {
		$merged = $defaults;
		foreach ( $stored as $key => $value ) {
			if ( is_array( $value ) && isset( $merged[ $key ] ) && is_array( $merged[ $key ] ) ) {
				$merged[ $key ] = $this->merge_distinct( $merged[ $key ], $value );
			} else {
				$merged[ $key ] = $value;
			}
		}
		return $merged;
	}
}
