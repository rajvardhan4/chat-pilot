<?php
namespace ChatPilot\Core;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class Rest
 * Site ownership verification endpoint.
 *
 * When the plugin connects, Chat Pilot Cloud calls
 *
 *   GET https://this-site/wp-json/chat-pilot/v1/site-token
 *
 * and expects the token this site minted at activation. That turns "a caller
 * claims to be example.com" into "example.com actually served our token",
 * which is the part a spoofed header cannot fake.
 *
 * The token is intentionally low-value: it proves control of this site's public
 * REST API and nothing more. It grants no access to Chat Pilot, and it is not
 * the Site API Key - that never leaves the server.
 */
class Rest {

	const NAMESPACE_V1 = 'chat-pilot/v1';

	/**
	 * Registers routes.
	 */
	public function __construct() {
		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
	}

	/**
	 * Route registration.
	 */
	public function register_routes() {
		register_rest_route(
			self::NAMESPACE_V1,
			'/site-token',
			array(
				'methods'             => 'GET',
				'callback'            => array( $this, 'site_token' ),
				// Deliberately public: the whole point is that Chat Pilot can
				// fetch it anonymously from the outside.
				'permission_callback' => '__return_true',
			)
		);
	}

	/**
	 * Returns the ownership token plus non-sensitive identification.
	 *
	 * @return \WP_REST_Response
	 */
	public function site_token() {
		$response = new \WP_REST_Response(
			array(
				'token'          => \ChatPilot\Api\Connection::site_token(),
				'site_url'       => home_url(),
				'plugin_version' => CHAT_PILOT_VERSION,
			),
			200
		);
		$response->header( 'Cache-Control', 'no-store' );
		return $response;
	}
}
