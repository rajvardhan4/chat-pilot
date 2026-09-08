<?php
/**
 * WordPress plugin integration harness.
 *
 * Loads the REAL Chat Pilot plugin source on top of a minimal WordPress shim
 * and drives the whole plugin -> SaaS contract against a live Chat Pilot server:
 *
 *   connect -> cache widget config -> submit the pre-chat form -> chat ->
 *   follow-up -> health -> failure handling -> disconnect
 *
 * Usage:  php run.php <saas-base-url> <site-api-key> <site-url>
 * Output: one JSON document on stdout describing every step.
 *
 * Nothing here re-implements plugin logic. Every call goes through
 * ChatPilot\Api\Client, which builds and signs the request exactly as it does
 * on a real WordPress site.
 */

ini_set( 'display_errors', 'stderr' );
ini_set( 'html_errors', '0' );
error_reporting( E_ALL & ~E_DEPRECATED & ~E_USER_DEPRECATED );

$base    = isset( $argv[1] ) ? rtrim( $argv[1], '/' ) : '';
$key     = isset( $argv[2] ) ? $argv[2] : '';
$siteUrl = isset( $argv[3] ) ? $argv[3] : 'https://wp-harness.example.com';

if ( ! $base || ! $key ) {
	fwrite( STDERR, "usage: php run.php <base-url> <site-api-key> <site-url>\n" );
	exit( 2 );
}

putenv( 'CP_SITE_URL=' . $siteUrl );

require __DIR__ . '/wp-shim.php';

// The plugin points at the SaaS through this constant.
define( 'CHAT_PILOT_API_URL', $base );

$pluginRoot = realpath( __DIR__ . '/../../../wordpress-plugin/chat-pilot' );
if ( ! $pluginRoot ) {
	fwrite( STDERR, "plugin source not found\n" );
	exit( 2 );
}

// Load the plugin bootstrap. Hooks are no-ops in the shim, so nothing runs
// until the harness calls it explicitly.
require $pluginRoot . '/chat-pilot.php';

$results = array();

function step( $name, callable $fn ) {
	global $results;
	try {
		$results[ $name ] = $fn();
	} catch ( CP_Ajax_Response $ajax ) {
		$results[ $name ] = array(
			'ajax_ok'     => $ajax->ok,
			'ajax_status' => $ajax->status,
			'payload'     => $ajax->payload,
		);
	} catch ( Throwable $e ) {
		$results[ $name ] = array( 'exception' => get_class( $e ) . ': ' . $e->getMessage() );
	}
}

/* ------------------------------------------------------------ activation -- */

step(
	'activate',
	function () {
		\ChatPilot\Core\Lifecycle::activate();
		return array(
			'site_token_length' => strlen( \ChatPilot\Api\Connection::site_token() ),
			'plugin_version'    => CHAT_PILOT_VERSION,
		);
	}
);

/* ---------------------------------------------------- rest ownership route -- */

step(
	'rest_site_token',
	function () {
		$rest     = new \ChatPilot\Core\Rest();
		$response = $rest->site_token();
		return array(
			'status' => $response->status,
			'token'  => $response->data['token'],
			'match'  => $response->data['token'] === \ChatPilot\Api\Connection::site_token(),
		);
	}
);

/* ----------------------------------------------- connect with a bad key -- */

step(
	'connect_invalid_key',
	function () {
		$result = \ChatPilot\Api\Connection::connect( 'cp_live_0000000000000000_notarealkeyvalue123' );
		return array(
			'success' => $result['success'],
			'code'    => $result['code'],
			'message' => $result['message'],
		);
	}
);

/* --------------------------------------------------- connect for real -- */

step(
	'connect',
	function () use ( $key ) {
		$result = \ChatPilot\Api\Connection::connect( $key );
		return array(
			'success'      => $result['success'],
			'code'         => $result['code'],
			'message'      => $result['message'],
			'website_name' => isset( $result['state']['website_name'] ) ? $result['state']['website_name'] : '',
			'domain'       => isset( $result['state']['domain'] ) ? $result['state']['domain'] : '',
			'account_name' => isset( $result['state']['account_name'] ) ? $result['state']['account_name'] : '',
			'is_connected' => \ChatPilot\Api\Connection::is_connected(),
			'masked_key'   => \ChatPilot\Api\Connection::masked_key(),
		);
	}
);

/* ------------------------------------------------------- widget config -- */

step(
	'widget_config',
	function () use ( $key ) {
		$config = \ChatPilot\Api\ConfigCache::get( true );
		$json   = wp_json_encode( $config );
		return array(
			'has_widget'       => ! empty( $config['widget'] ),
			'enabled'          => ! empty( $config['widget']['enabled'] ),
			'display_name'     => isset( $config['widget']['displayName'] ) ? $config['widget']['displayName'] : '',
			'prechat_enabled'  => ! empty( $config['widget']['prechat']['enabled'] ),
			'prechat_form_id'  => isset( $config['widget']['prechat']['formId'] ) ? $config['widget']['prechat']['formId'] : '',
			'prechat_fields'   => isset( $config['widget']['prechat']['fields'] )
				? array_column( $config['widget']['prechat']['fields'], 'key' )
				: array(),
			'fallback_message' => isset( $config['messages']['fallback'] ) ? $config['messages']['fallback'] : '',
			// Proof that no secret rides along in the cached payload.
			'contains_site_key'     => false !== strpos( $json, $key ),
			'contains_provider_key' => false !== strpos( $json, 'mock-ok-' ),
			'contains_system_prompt' => false !== strpos( $json, 'GROUNDING' ),
		);
	}
);

/* --------------------------------------------------- widget rendering -- */

step(
	'widget_markup',
	function () {
		$plugin   = \ChatPilot\Core\Plugin::instance();
		$frontend = new \ChatPilot\Core\Frontend();

		ob_start();
		try {
			$frontend->render_chat_widget();
		} finally {
			$html = ob_get_clean();
		}

		return array(
			'rendered'        => strlen( $html ) > 0,
			'has_container'   => false !== strpos( $html, 'id="chat-pilot-widget-container"' ),
			'has_launcher'    => false !== strpos( $html, 'id="chat-pilot-widget-launcher"' ),
			'has_box'         => false !== strpos( $html, 'id="chat-pilot-widget-box"' ),
			'has_prechat'     => false !== strpos( $html, 'id="cp-widget-prechat-form"' ),
			'has_input'       => false !== strpos( $html, 'id="cp-widget-input-field"' ),
			'has_branding'    => false !== strpos( $html, 'Powered by Chat Pilot' ),
			'leaks_secret'    => false !== strpos( $html, 'cp_live_' ),
			'length'          => strlen( $html ),
		);
	}
);

/* ------------------------------------------------- pre-chat submission -- */

$GLOBALS['cp_valid_nonce'] = true;
$sessionId                 = 'wpharness' . bin2hex( random_bytes( 8 ) );

step(
	'prechat_missing_required',
	function () use ( $sessionId ) {
		$config = \ChatPilot\Api\ConfigCache::get();
		$formId = $config['widget']['prechat']['formId'];

		$_POST = array(
			'form_id'    => $formId,
			'session_id' => $sessionId,
			'fields'     => array( 'name' => 'Harness Visitor' ),
			'page_url'   => 'https://wp-harness.example.com/pricing',
			'_wpnonce'   => 'test-nonce',
		);

		$ajax = new \ChatPilot\Admin\Ajax();
		$ajax->ajax_submit_prechat_form();
		return array( 'unreachable' => true );
	}
);

step(
	'prechat_valid',
	function () use ( $sessionId ) {
		$config = \ChatPilot\Api\ConfigCache::get();
		$formId = $config['widget']['prechat']['formId'];

		$_POST = array(
			'form_id'    => $formId,
			'session_id' => $sessionId,
			'fields'     => array(
				'name'  => 'Harness Visitor',
				'email' => 'harness@visitor.example',
				'phone' => '555-0164',
			),
			'page_url'   => 'https://wp-harness.example.com/pricing',
			'_wpnonce'   => 'test-nonce',
		);

		$ajax = new \ChatPilot\Admin\Ajax();
		$ajax->ajax_submit_prechat_form();
		return array( 'unreachable' => true );
	}
);

/* ------------------------------------------------------------ chatting -- */

step(
	'chat_first',
	function () use ( $sessionId ) {
		$_POST = array(
			'session_id' => $sessionId,
			'message'    => 'How much does water heater replacement cost?',
			'page_url'   => 'https://wp-harness.example.com/pricing',
			'_wpnonce'   => 'test-nonce',
		);
		$ajax = new \ChatPilot\Admin\Ajax();
		$ajax->ajax_chat();
		return array( 'unreachable' => true );
	}
);

step(
	'chat_followup',
	function () use ( $sessionId ) {
		$_POST = array(
			'session_id' => $sessionId,
			'message'    => 'How long does that take?',
			'page_url'   => 'https://wp-harness.example.com/pricing',
			'_wpnonce'   => 'test-nonce',
		);
		$ajax = new \ChatPilot\Admin\Ajax();
		$ajax->ajax_chat();
		return array( 'unreachable' => true );
	}
);

step(
	'chat_missing_knowledge',
	function () use ( $sessionId ) {
		$_POST = array(
			'session_id' => $sessionId . 'b',
			'message'    => 'Do you sell replacement guitar strings for a Stratocaster?',
			'_wpnonce'   => 'test-nonce',
		);
		$ajax = new \ChatPilot\Admin\Ajax();
		$ajax->ajax_chat();
		return array( 'unreachable' => true );
	}
);

/* --------------------------------------------------- nonce enforcement -- */

step(
	'chat_without_nonce',
	function () use ( $sessionId ) {
		$GLOBALS['cp_valid_nonce'] = false;
		$_POST                     = array(
			'session_id' => $sessionId,
			'message'    => 'This should be refused.',
		);
		$ajax = new \ChatPilot\Admin\Ajax();
		try {
			$ajax->ajax_chat();
			return array( 'unreachable' => true );
		} finally {
			$GLOBALS['cp_valid_nonce'] = true;
		}
	}
);

/* -------------------------------------------------- admin capability -- */

step(
	'connect_without_capability',
	function () use ( $key ) {
		$GLOBALS['cp_is_admin'] = false;
		$_POST                  = array( 'api_key' => $key, '_wpnonce' => 'test-nonce' );
		$ajax                   = new \ChatPilot\Admin\Ajax();
		$ajax->ajax_connect();
		return array( 'unreachable' => true );
	}
);

/* ---------------------------------------------------------------- health -- */

step(
	'health',
	function () {
		$result = \ChatPilot\Api\Connection::health();
		return array(
			'success'             => $result['success'],
			'provider_configured' => ! empty( $result['health']['provider_configured'] ),
			'knowledge_documents' => isset( $result['health']['knowledge_documents'] ) ? (int) $result['health']['knowledge_documents'] : 0,
			'widget_enabled'      => ! empty( $result['health']['widget_enabled'] ),
			'website_status'      => isset( $result['health']['website_status'] ) ? $result['health']['website_status'] : '',
		);
	}
);

/* ------------------------------------------------- replay / tamper proof -- */

step(
	'signature_required',
	function () use ( $base, $key ) {
		// Same key, no signature headers at all.
		$ch = curl_init( $base . '/api/v1/site/health' );
		curl_setopt_array(
			$ch,
			array(
				CURLOPT_RETURNTRANSFER => true,
				CURLOPT_HTTPHEADER     => array( 'X-Chat-Pilot-Key: ' . $key ),
				CURLOPT_TIMEOUT        => 10,
			)
		);
		$body   = curl_exec( $ch );
		$status = (int) curl_getinfo( $ch, CURLINFO_RESPONSE_CODE );
		return array( 'status' => $status, 'body' => substr( (string) $body, 0, 200 ) );
	}
);

/* ------------------------------------------------------------- log check -- */

step(
	'log_redaction',
	function () use ( $key ) {
		$entries = \ChatPilot\Common\Logger::entries();
		$json    = wp_json_encode( $entries );
		return array(
			'entries'          => count( $entries ),
			'contains_site_key' => false !== strpos( $json, $key ),
		);
	}
);

/* ------------------------------------------------- admin refusal contract -- */

/*
 * Every administrative refusal must carry BOTH a non-2xx status and a message
 * the administrator can act on. The status is what routes the response to
 * jQuery's error handler, and the message is what has to be read out of it -
 * so a refusal with a status and no message, or with a message the browser
 * never reads, surfaces as "Something went wrong. Please try again."
 */
$GLOBALS['cp_valid_nonce'] = true;
$GLOBALS['cp_is_admin'] = true;
$cp_ajax = new \ChatPilot\Admin\Ajax();

step(
	'connect_rejects_malformed_key',
	function () use ( $cp_ajax ) {
		$_POST = array( 'api_key' => 'not-a-chat-pilot-key', '_wpnonce' => 'test-nonce' );
		$cp_ajax->ajax_connect();
		return array( 'unreachable' => true );
	}
);

step(
	'connect_rejects_empty_key',
	function () use ( $cp_ajax ) {
		$_POST = array( 'api_key' => '   ', '_wpnonce' => 'test-nonce' );
		$cp_ajax->ajax_connect();
		return array( 'unreachable' => true );
	}
);

/* ------------------------------------------------------- cloud address -- */

step(
	'api_url_default',
	function () {
		return array(
			'base'     => \ChatPilot\Api\Client::base_url(),
			'saved'    => \ChatPilot\Api\Client::configured_base_url(),
			'is_pinned' => \ChatPilot\Api\Client::is_pinned(),
		);
	}
);

step(
	'api_url_rejects_non_http',
	function () use ( $cp_ajax ) {
		$_POST = array( 'api_url' => 'javascript:alert(1)', '_wpnonce' => 'test-nonce' );
		$cp_ajax->ajax_save_api_url();
		return array( 'unreachable' => true );
	}
);

step(
	'api_url_saves',
	function () use ( $cp_ajax, $base ) {
		$_POST = array( 'api_url' => $base . '/', '_wpnonce' => 'test-nonce' );
		try {
			$cp_ajax->ajax_save_api_url();
		} catch ( CP_Ajax_Response $ajax ) {
			return array(
				'ajax_ok'    => $ajax->ok,
				'payload'    => $ajax->payload,
				'base_after' => \ChatPilot\Api\Client::base_url(),
				'saved'      => \ChatPilot\Api\Client::configured_base_url(),
			);
		}
		return array( 'unreachable' => true );
	}
);

step(
	'api_url_clears_back_to_default',
	function () use ( $cp_ajax ) {
		$_POST = array( 'api_url' => '', '_wpnonce' => 'test-nonce' );
		try {
			$cp_ajax->ajax_save_api_url();
		} catch ( CP_Ajax_Response $ajax ) {
			return array(
				'ajax_ok' => $ajax->ok,
				'saved'   => \ChatPilot\Api\Client::configured_base_url(),
				'base'    => \ChatPilot\Api\Client::base_url(),
				'default' => \ChatPilot\Api\Client::default_base_url(),
			);
		}
		return array( 'unreachable' => true );
	}
);

/* ------------------------------------------------------------ tab access -- */

/*
 * Every tab has to be reachable whether or not this site is connected.
 * Bouncing an unconnected click back to Connection made the strip look broken:
 * the tab simply appeared not to respond, with nothing on screen to say why.
 */
step(
	'tab_access',
	function () {
		$controller = new \ChatPilot\Admin\TabsController();
		$saved      = \ChatPilot\Api\Connection::get_api_key();
		$out        = array();

		foreach ( array( 'connected', 'disconnected' ) as $mode ) {
			if ( 'disconnected' === $mode ) {
				\ChatPilot\Api\Connection::set_api_key( '' );
			}

			$resolved = array();
			foreach ( array_keys( $controller->get_tabs() ) as $tab ) {
				$_GET['tab']     = $tab;
				$resolved[ $tab ] = $controller->get_active_tab();
			}

			unset( $_GET['tab'] );

			// Rendering Dashboard in this state proves the tab opens and says
			// why it is empty, rather than opening blank or bouncing away.
			$active_tab = 'dashboard';
			ob_start();
			include CHAT_PILOT_PATH . 'templates/tab-dashboard.php';
			$dashboard = ob_get_clean();

			$out[ $mode ] = array(
				'resolved'  => $resolved,
				'landing'   => $controller->get_active_tab(),
				'notice'    => false !== strpos( $dashboard, 'cp-card-empty' ),
				'notice_cta' => false !== strpos( $dashboard, 'tab=connection' ),
			);
		}

		\ChatPilot\Api\Connection::set_api_key( $saved );
		return $out;
	}
);

/* ------------------------------------------------------- template render -- */

/*
 * Renders every admin template the plugin still ships.
 *
 * These are the screens an administrator actually looks at, and a PHP notice or
 * a fatal in one of them is invisible to every other check here - the AJAX
 * routes and the widget markup would all still pass. Rendering them catches an
 * undefined variable or a call to a helper that no longer exists.
 */
step(
	'render_templates',
	function () {
		$controller = new \ChatPilot\Admin\TabsController();
		$tabs       = $controller->get_tabs();
		$out        = array();

		foreach ( array_keys( $tabs ) as $tab ) {
			$active_tab = $tab;
			$file       = CHAT_PILOT_PATH . 'templates/tab-' . $tab . '.php';

			ob_start();
			$error = '';
			set_error_handler(
				function ( $no, $str ) use ( &$error ) {
					$error = $str;
					return true;
				}
			);
			try {
				include $file;
			} catch ( Throwable $e ) {
				$error = get_class( $e ) . ': ' . $e->getMessage();
			}
			restore_error_handler();
			$html = ob_get_clean();

			$out[ $tab ] = array(
				'exists'    => file_exists( $file ),
				'length'    => strlen( $html ),
				'error'     => $error,
				'has_card'  => false !== strpos( $html, 'cp-card' ),
				// A key field must be masked and must carry its reveal button.
				'has_eye'   => false !== strpos( $html, 'cp-eye' ),
				'key_typed' => false !== strpos( $html, 'type="password" id="cp-api-key"' ),
				'plain_key' => false !== strpos( $html, 'type="text" id="cp-api-key"' ),
				'api_url_field' => false !== strpos( $html, 'cp-api-url' ),
				'not_connected_notice' => false !== strpos( $html, 'cp-card-empty' ),
			);
		}

		// The shell itself, which draws the header, the brand and the tab strip.
		$active_tab = 'dashboard';
		ob_start();
		$shell_error = '';
		set_error_handler(
			function ( $no, $str ) use ( &$shell_error ) {
				$shell_error = $str;
				return true;
			}
		);
		try {
			include CHAT_PILOT_PATH . 'templates/admin-dashboard.php';
		} catch ( Throwable $e ) {
			$shell_error = get_class( $e ) . ': ' . $e->getMessage();
		}
		restore_error_handler();
		$shell_html = ob_get_clean();

		$out['_shell'] = array(
			'error'     => $shell_error,
			'length'    => strlen( $shell_html ),
			'tab_links' => substr_count( $shell_html, 'cp-tab-link' ),
			'has_logo'  => false !== strpos( $shell_html, 'cp-logo' ),
		);

		return $out;
	}
);

/* --------------------------------------------------------------- tabs -- */

step(
	'admin_tabs',
	function () {
		$controller = new \ChatPilot\Admin\TabsController();
		return array(
			'tabs'         => array_keys( $controller->get_tabs() ),
			'destinations' => array_keys( $controller->cloud_destinations() ),
		);
	}
);

/* ------------------------------------------------------------ disconnect -- */

step(
	'disconnect',
	function () {
		$result = \ChatPilot\Api\Connection::disconnect();
		return array(
			'success'      => $result['success'],
			'key_cleared'  => '' === \ChatPilot\Api\Connection::get_api_key(),
			'is_connected' => \ChatPilot\Api\Connection::is_connected(),
		);
	}
);

echo wp_json_encode( $results ), "\n";
