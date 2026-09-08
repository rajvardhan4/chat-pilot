<?php
/**
 * Focused harness: the Chat Pilot Cloud address, with no wp-config.php pin.
 *
 * run.php defines CHAT_PILOT_API_URL before loading the plugin, which is the
 * pinned case - correct to test, but it means the saved-setting path never
 * executes there. This script leaves the constant undefined so the plugin falls
 * back to its shipped default, then drives the real admin route that saves the
 * address and checks what the signing client actually resolves afterwards.
 *
 * Usage:  php run-cloud-url.php <saas-base-url> <site-url>
 * Output: one JSON document on stdout.
 */

ini_set( 'display_errors', 'stderr' );
ini_set( 'html_errors', '0' );
error_reporting( E_ALL & ~E_DEPRECATED & ~E_USER_DEPRECATED );

$base    = isset( $argv[1] ) ? rtrim( $argv[1], '/' ) : '';
$siteUrl = isset( $argv[2] ) ? $argv[2] : 'https://wp-harness.example.com';

if ( ! $base ) {
	fwrite( STDERR, "usage: php run-cloud-url.php <base-url> <site-url>\n" );
	exit( 2 );
}

putenv( 'CP_SITE_URL=' . $siteUrl );

require __DIR__ . '/wp-shim.php';

// Deliberately NOT defining CHAT_PILOT_API_URL: this is the unpinned case.

$pluginRoot = realpath( __DIR__ . '/../../../wordpress-plugin/chat-pilot' );
if ( ! $pluginRoot ) {
	fwrite( STDERR, "plugin source not found\n" );
	exit( 2 );
}

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

\ChatPilot\Core\Plugin::instance();

$GLOBALS['cp_valid_nonce'] = true;
$GLOBALS['cp_is_admin']    = true;
$ajax                      = new \ChatPilot\Admin\Ajax();

step(
	'unpinned',
	function () {
		return array(
			'is_pinned' => \ChatPilot\Api\Client::is_pinned(),
			'base'      => \ChatPilot\Api\Client::base_url(),
			'default'   => \ChatPilot\Api\Client::default_base_url(),
			'saved'     => \ChatPilot\Api\Client::configured_base_url(),
		);
	}
);

step(
	'rejects_non_http',
	function () use ( $ajax ) {
		$_POST = array( 'api_url' => 'javascript:alert(1)', '_wpnonce' => 'test-nonce' );
		$ajax->ajax_save_api_url();
		return array( 'unreachable' => true );
	}
);

step(
	'rejects_hostless',
	function () use ( $ajax ) {
		$_POST = array( 'api_url' => 'https://', '_wpnonce' => 'test-nonce' );
		$ajax->ajax_save_api_url();
		return array( 'unreachable' => true );
	}
);

step(
	'saves_and_takes_effect',
	function () use ( $ajax, $base ) {
		// A trailing slash is exactly what a customer pastes from a browser bar.
		$_POST = array( 'api_url' => $base . '/', '_wpnonce' => 'test-nonce' );
		try {
			$ajax->ajax_save_api_url();
		} catch ( CP_Ajax_Response $r ) {
			return array(
				'ajax_ok' => $r->ok,
				'message' => isset( $r->payload['message'] ) ? $r->payload['message'] : '',
				'base'    => \ChatPilot\Api\Client::base_url(),
				'saved'   => \ChatPilot\Api\Client::configured_base_url(),
			);
		}
		return array( 'unreachable' => true );
	}
);

step(
	'signs_against_the_saved_address',
	function () {
		// No key is stored, so this stops at the "not connected" guard - but it
		// proves the client resolved the saved host rather than the default.
		$result = \ChatPilot\Api\Client::get( '/api/' . CHAT_PILOT_API_VERSION . '/site/config' );
		return array(
			'base' => \ChatPilot\Api\Client::base_url(),
			'code' => isset( $result['code'] ) ? $result['code'] : '',
		);
	}
);

step(
	'clears_back_to_default',
	function () use ( $ajax ) {
		$_POST = array( 'api_url' => '', '_wpnonce' => 'test-nonce' );
		try {
			$ajax->ajax_save_api_url();
		} catch ( CP_Ajax_Response $r ) {
			return array(
				'ajax_ok' => $r->ok,
				'saved'   => \ChatPilot\Api\Client::configured_base_url(),
				'base'    => \ChatPilot\Api\Client::base_url(),
				'default' => \ChatPilot\Api\Client::default_base_url(),
			);
		}
		return array( 'unreachable' => true );
	}
);

step(
	'refuses_without_capability',
	function () use ( $ajax, $base ) {
		$GLOBALS['cp_is_admin'] = false;
		$_POST                  = array( 'api_url' => $base, '_wpnonce' => 'test-nonce' );
		try {
			$ajax->ajax_save_api_url();
		} catch ( CP_Ajax_Response $r ) {
			$GLOBALS['cp_is_admin'] = true;
			return array(
				'ajax_ok'     => $r->ok,
				'ajax_status' => $r->status,
				'message'     => isset( $r->payload['message'] ) ? $r->payload['message'] : '',
				'saved'       => \ChatPilot\Api\Client::configured_base_url(),
			);
		}
		$GLOBALS['cp_is_admin'] = true;
		return array( 'unreachable' => true );
	}
);

echo wp_json_encode( $results ), "\n";
