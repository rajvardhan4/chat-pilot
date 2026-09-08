<?php
/**
 * Minimal WordPress shim.
 *
 * Just enough of the WordPress API for the Chat Pilot plugin's REAL PHP source
 * to execute outside WordPress, so the plugin -> SaaS contract can be tested
 * for real rather than asserted on paper.
 *
 * Only functions the plugin actually calls on the paths under test are
 * implemented. Options live in a process-local array, and the HTTP layer is a
 * thin cURL wrapper that mirrors wp_remote_request semantics.
 */

define( 'ABSPATH', __DIR__ . '/' );
define( 'MINUTE_IN_SECONDS', 60 );
define( 'HOUR_IN_SECONDS', 3600 );

/* ------------------------------------------------------------- options -- */

// WordPress exposes the core version as a global; Lifecycle checks it.
$GLOBALS['wp_version'] = '6.7.1';

$GLOBALS['cp_options']    = array();
$GLOBALS['cp_transients'] = array();
$GLOBALS['cp_site_url']   = getenv( 'CP_SITE_URL' ) ?: 'https://wp-harness.example.com';

function get_option( $name, $default = false ) {
	return array_key_exists( $name, $GLOBALS['cp_options'] ) ? $GLOBALS['cp_options'][ $name ] : $default;
}

function update_option( $name, $value, $autoload = null ) {
	$GLOBALS['cp_options'][ $name ] = $value;
	return true;
}

function delete_option( $name ) {
	unset( $GLOBALS['cp_options'][ $name ] );
	return true;
}

function set_transient( $name, $value, $ttl = 0 ) {
	$GLOBALS['cp_transients'][ $name ] = array( 'value' => $value, 'expires' => time() + (int) $ttl );
	return true;
}

function get_transient( $name ) {
	if ( ! isset( $GLOBALS['cp_transients'][ $name ] ) ) {
		return false;
	}
	$entry = $GLOBALS['cp_transients'][ $name ];
	if ( $entry['expires'] < time() ) {
		unset( $GLOBALS['cp_transients'][ $name ] );
		return false;
	}
	return $entry['value'];
}

function delete_transient( $name ) {
	unset( $GLOBALS['cp_transients'][ $name ] );
	return true;
}

/* ---------------------------------------------------------------- misc -- */

function home_url( $path = '' ) {
	return rtrim( $GLOBALS['cp_site_url'], '/' ) . $path;
}

function admin_url( $path = '' ) {
	return home_url( '/wp-admin/' . ltrim( $path, '/' ) );
}

function untrailingslashit( $value ) {
	return rtrim( (string) $value, '/\\' );
}

function trailingslashit( $value ) {
	return untrailingslashit( $value ) . '/';
}

function apply_filters( $hook, $value ) {
	return $value;
}

function add_action() {}
function add_filter() {}
function do_action() {}

function __( $text, $domain = '' ) {
	return $text;
}

function esc_html__( $text, $domain = '' ) {
	return $text;
}

function _e( $text, $domain = '' ) {
	echo $text;
}

function esc_html_e( $text, $domain = '' ) {
	echo esc_html( $text );
}

function esc_attr_e( $text, $domain = '' ) {
	echo esc_attr( $text );
}

function esc_attr__( $text, $domain = '' ) {
	return $text;
}

function esc_html( $text ) {
	return htmlspecialchars( (string) $text, ENT_QUOTES, 'UTF-8' );
}

function esc_attr( $text ) {
	return esc_html( $text );
}

function esc_url( $url ) {
	return filter_var( (string) $url, FILTER_SANITIZE_URL );
}

function esc_url_raw( $url ) {
	return filter_var( (string) $url, FILTER_SANITIZE_URL );
}

function esc_sql( $value ) {
	return addslashes( (string) $value );
}

function sanitize_text_field( $value ) {
	$value = (string) $value;
	$value = strip_tags( $value );
	$value = preg_replace( '/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', '', $value );
	return trim( $value );
}

function sanitize_textarea_field( $value ) {
	$value = (string) $value;
	$value = strip_tags( $value );
	$value = preg_replace( '/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', '', $value );
	return trim( $value );
}

function sanitize_key( $value ) {
	return preg_replace( '/[^a-z0-9_\-]/', '', strtolower( (string) $value ) );
}

function sanitize_email( $value ) {
	$clean = filter_var( trim( (string) $value ), FILTER_VALIDATE_EMAIL );
	return $clean ? $clean : '';
}

function sanitize_hex_color( $value ) {
	return preg_match( '/^#[0-9a-fA-F]{6}$/', (string) $value ) ? $value : null;
}

function wp_strip_all_tags( $value ) {
	return trim( strip_tags( (string) $value ) );
}

function wp_unslash( $value ) {
	if ( is_array( $value ) ) {
		return array_map( 'wp_unslash', $value );
	}
	return is_string( $value ) ? stripslashes( $value ) : $value;
}

function wp_json_encode( $data ) {
	return json_encode( $data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );
}

function wp_parse_url( $url, $component = -1 ) {
	return parse_url( $url, $component );
}

function current_time( $type = 'mysql' ) {
	return 'timestamp' === $type ? time() : gmdate( 'Y-m-d H:i:s' );
}

function wp_generate_password( $length = 12, $special = true, $extra = false ) {
	$chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
	$out   = '';
	for ( $i = 0; $i < $length; $i++ ) {
		$out .= $chars[ random_int( 0, strlen( $chars ) - 1 ) ];
	}
	return $out;
}

function current_user_can( $capability ) {
	return ! empty( $GLOBALS['cp_is_admin'] );
}

function is_admin() {
	return false;
}

function is_feed() {
	return false;
}

function is_robots() {
	return false;
}

function get_queried_object_id() {
	return 0;
}

function add_query_arg( $args = array(), $url = '' ) {
	return $url ? $url : home_url();
}

function deactivate_plugins( $plugin ) {}

function wp_die( $message = '', $title = '', $args = array() ) {
	throw new RuntimeException( 'wp_die: ' . ( is_string( $message ) ? $message : 'error' ) );
}

function flush_rewrite_rules() {}

function plugin_dir_path( $file ) {
	return rtrim( dirname( $file ), '/\\' ) . '/';
}

function plugin_dir_url( $file ) {
	return home_url( '/wp-content/plugins/chat-pilot/' );
}

function plugin_basename( $file ) {
	return 'chat-pilot/chat-pilot.php';
}

function register_activation_hook() {}
function register_deactivation_hook() {}

function checked( $checked, $current = true, $echo = true ) {
	$result = ( (string) $checked === (string) $current ) ? ' checked="checked"' : '';
	if ( $echo ) {
		echo $result;
	}
	return $result;
}

function selected( $selected, $current = true, $echo = true ) {
	$result = ( (string) $selected === (string) $current ) ? ' selected="selected"' : '';
	if ( $echo ) {
		echo $result;
	}
	return $result;
}

/* ---------------------------------------------------------------- http -- */

class WP_Error {

	private $message;

	public function __construct( $code = '', $message = '' ) {
		$this->message = $message;
	}

	public function get_error_message() {
		return $this->message;
	}
}

function is_wp_error( $thing ) {
	return $thing instanceof WP_Error;
}

/**
 * cURL implementation of wp_remote_request with the same return shape.
 *
 * @param string $url  Request URL.
 * @param array  $args Request arguments.
 * @return array|WP_Error
 */
function wp_remote_request( $url, $args = array() ) {
	$method  = isset( $args['method'] ) ? strtoupper( $args['method'] ) : 'GET';
	$timeout = isset( $args['timeout'] ) ? (int) $args['timeout'] : 20;
	$headers = isset( $args['headers'] ) ? $args['headers'] : array();
	$body    = isset( $args['body'] ) ? $args['body'] : null;

	$header_lines = array();
	foreach ( $headers as $name => $value ) {
		$header_lines[] = $name . ': ' . $value;
	}

	$ch = curl_init( $url );
	curl_setopt_array(
		$ch,
		array(
			CURLOPT_RETURNTRANSFER => true,
			CURLOPT_CUSTOMREQUEST  => $method,
			CURLOPT_HTTPHEADER     => $header_lines,
			CURLOPT_TIMEOUT        => $timeout,
			CURLOPT_FOLLOWLOCATION => false,
			// The harness talks to a local test server over plain HTTP.
			CURLOPT_SSL_VERIFYPEER => false,
			CURLOPT_SSL_VERIFYHOST => 0,
		)
	);

	if ( null !== $body && '' !== $body ) {
		curl_setopt( $ch, CURLOPT_POSTFIELDS, $body );
	}

	$response = curl_exec( $ch );
	if ( false === $response ) {
		return new WP_Error( 'http_request_failed', curl_error( $ch ) );
	}

	$status = (int) curl_getinfo( $ch, CURLINFO_RESPONSE_CODE );

	return array(
		'response' => array( 'code' => $status ),
		'body'     => $response,
	);
}

function wp_remote_retrieve_response_code( $response ) {
	return isset( $response['response']['code'] ) ? $response['response']['code'] : 0;
}

function wp_remote_retrieve_body( $response ) {
	return isset( $response['body'] ) ? $response['body'] : '';
}

/* --------------------------------------------------------------- ajax -- */

class CP_Ajax_Response extends Exception {

	public $payload;
	public $ok;
	/**
	 * The HTTP status WordPress would send.
	 *
	 * Worth capturing rather than discarding: wp_send_json_error() answers with
	 * a 4xx, which jQuery routes to its error handler rather than its success
	 * handler. Any refusal that carries a message the administrator needs to
	 * read therefore has to be read out of the error response, and a harness
	 * that threw the status away could not tell that apart from a 200.
	 *
	 * @var int
	 */
	public $status;

	public function __construct( $payload, $ok, $status ) {
		parent::__construct( 'ajax-response' );
		$this->payload = $payload;
		$this->ok      = $ok;
		$this->status  = (int) $status;
	}
}

function wp_send_json_success( $data = null, $status = 200 ) {
	throw new CP_Ajax_Response( $data, true, $status );
}

function wp_send_json_error( $data = null, $status = 400 ) {
	throw new CP_Ajax_Response( $data, false, $status );
}

function check_ajax_referer( $action, $query_arg = false, $die = true ) {
	return ! empty( $GLOBALS['cp_valid_nonce'] );
}

function wp_create_nonce( $action ) {
	return 'test-nonce';
}

function wp_verify_nonce( $nonce, $action ) {
	return 'test-nonce' === $nonce ? 1 : false;
}

function wp_localize_script() {}
function wp_enqueue_script() {}
function wp_enqueue_style() {}
function register_rest_route() {}

class WP_REST_Response {

	public $data;
	public $status;

	public function __construct( $data, $status = 200 ) {
		$this->data   = $data;
		$this->status = $status;
	}

	public function header( $name, $value ) {}
}
