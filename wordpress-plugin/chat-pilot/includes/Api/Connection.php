<?php
namespace ChatPilot\Api;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class Connection
 * Owns the Site API Key and the connection state.
 *
 * Storage notes
 * -------------
 * The key lives in a single autoload=no option. It is the only secret this
 * plugin holds, and it is deliberately never localised into any script, never
 * echoed into markup, and never returned by an AJAX handler. Frontend requests
 * are proxied through admin-ajax so the key stays server-side.
 */
class Connection {

	const OPTION_KEY    = 'chat_pilot_site_api_key';
	const OPTION_STATE  = 'chat_pilot_connection_state';
	const OPTION_TOKEN  = 'chat_pilot_site_token';

	/**
	 * Human-readable copy for every status the SaaS can return.
	 *
	 * Keys map to the API error codes so the plugin never has to show a raw
	 * message from the wire, and visitors never see one at all.
	 *
	 * @return array
	 */
	public static function status_messages() {
		return array(
			'connected'            => __( 'Connected', 'chat-pilot' ),
			'site_key_invalid'     => __( 'That Site API Key was not recognised. Copy it again from your Chat Pilot dashboard.', 'chat-pilot' ),
			'site_key_revoked'     => __( 'This Site API Key has been revoked. Generate a new key in Chat Pilot and reconnect.', 'chat-pilot' ),
			'domain_mismatch'      => __( 'This key is registered to a different domain. Check the website URL in your Chat Pilot dashboard.', 'chat-pilot' ),
			'website_disabled'     => __( 'This website is currently disabled in Chat Pilot.', 'chat-pilot' ),
			'account_suspended'    => __( 'This Chat Pilot account is suspended. Please contact support.', 'chat-pilot' ),
			'subscription_inactive'=> __( 'This Chat Pilot subscription is not active. Please update your billing to continue.', 'chat-pilot' ),
			'rate_limited'         => __( 'Chat Pilot is receiving too many requests from this site. Please wait a moment.', 'chat-pilot' ),
			'transport_error'      => __( 'Chat Pilot could not be reached. Check that your server can make outbound HTTPS requests.', 'chat-pilot' ),
			'malformed_response'   => __( 'Chat Pilot returned an unexpected response. Please try again shortly.', 'chat-pilot' ),
			'not_connected'        => __( 'Not connected yet.', 'chat-pilot' ),
		);
	}

	/**
	 * Translates an API error code into friendly copy.
	 *
	 * @param string $code    API error code.
	 * @param string $fallback Fallback message.
	 * @return string
	 */
	public static function friendly_message( $code, $fallback = '' ) {
		$messages = self::status_messages();
		if ( isset( $messages[ $code ] ) ) {
			return $messages[ $code ];
		}
		return $fallback ? $fallback : __( 'Chat Pilot could not complete that request.', 'chat-pilot' );
	}

	/**
	 * Reads the stored Site API Key.
	 *
	 * @return string
	 */
	public static function get_api_key() {
		return (string) get_option( self::OPTION_KEY, '' );
	}

	/**
	 * Stores the Site API Key.
	 *
	 * @param string $key Raw key.
	 */
	public static function set_api_key( $key ) {
		update_option( self::OPTION_KEY, trim( (string) $key ), false );
	}

	/**
	 * Removes the key and all cached state.
	 */
	public static function forget() {
		delete_option( self::OPTION_KEY );
		delete_option( self::OPTION_STATE );
		ConfigCache::flush();
	}

	/**
	 * Masked hint safe to render in the admin UI.
	 *
	 * @return string
	 */
	public static function masked_key() {
		$key = self::get_api_key();
		if ( strlen( $key ) < 16 ) {
			return '';
		}
		return substr( $key, 0, 14 ) . str_repeat( '*', 8 ) . substr( $key, -4 );
	}

	/**
	 * Connection state cached from the last successful handshake.
	 *
	 * @return array
	 */
	public static function get_state() {
		$state = get_option( self::OPTION_STATE, array() );
		return is_array( $state ) ? $state : array();
	}

	/**
	 * True when the plugin has a verified connection.
	 *
	 * @return bool
	 */
	public static function is_connected() {
		$state = self::get_state();
		return ! empty( self::get_api_key() ) && ! empty( $state['connected'] );
	}

	/**
	 * The per-site ownership token the SaaS asks this site to echo back.
	 *
	 * It is a public, low-value nonce: possessing it proves only that you can
	 * read this site's REST API, which is exactly the property we want.
	 *
	 * @return string
	 */
	public static function site_token() {
		$token = get_option( self::OPTION_TOKEN, '' );
		if ( ! $token ) {
			$token = wp_generate_password( 32, false, false );
			update_option( self::OPTION_TOKEN, $token, false );
		}
		return $token;
	}

	/**
	 * Performs the connection handshake against Chat Pilot Cloud.
	 *
	 * @param string $api_key Key to try. Empty uses the stored key.
	 * @return array Result: array( 'success' => bool, 'message' => string, 'code' => string, 'state' => array ).
	 */
	public static function connect( $api_key = '' ) {
		global $wp_version;

		$key    = $api_key ? trim( $api_key ) : self::get_api_key();
		$result = Client::post(
			'/api/' . CHAT_PILOT_API_VERSION . '/site/connect',
			array(
				'site_url'       => home_url(),
				'plugin_version' => CHAT_PILOT_VERSION,
				'wp_version'     => isset( $wp_version ) ? $wp_version : '',
			),
			$key
		);

		if ( empty( $result['success'] ) ) {
			$code = isset( $result['code'] ) ? $result['code'] : 'api_error';

			// A failed handshake must not silently keep an old "connected" flag.
			update_option(
				self::OPTION_STATE,
				array(
					'connected'  => false,
					'code'       => $code,
					'checked_at' => current_time( 'mysql' ),
				),
				false
			);

			return array(
				'success' => false,
				'code'    => $code,
				'message' => self::friendly_message( $code, isset( $result['message'] ) ? $result['message'] : '' ),
				'state'   => self::get_state(),
			);
		}

		$data    = $result['data'];
		$website = isset( $data['website'] ) ? $data['website'] : array();
		$account = isset( $data['account'] ) ? $data['account'] : array();

		$state = array(
			'connected'      => true,
			'code'           => 'connected',
			'website_id'     => isset( $website['id'] ) ? sanitize_text_field( $website['id'] ) : '',
			'website_name'   => isset( $website['name'] ) ? sanitize_text_field( $website['name'] ) : '',
			'domain'         => isset( $website['domain'] ) ? sanitize_text_field( $website['domain'] ) : '',
			'verified'       => ! empty( $website['verified'] ),
			'ownership'      => isset( $website['ownership_check'] ) ? sanitize_key( $website['ownership_check'] ) : '',
			'account_name'   => isset( $account['name'] ) ? sanitize_text_field( $account['name'] ) : '',
			'dashboard_url'  => isset( $data['dashboard_url'] ) ? esc_url_raw( $data['dashboard_url'] ) : '',
			'api_version'    => isset( $data['api_version'] ) ? sanitize_key( $data['api_version'] ) : CHAT_PILOT_API_VERSION,
			'connected_at'   => current_time( 'mysql' ),
			'checked_at'     => current_time( 'mysql' ),
		);

		if ( $key ) {
			self::set_api_key( $key );
		}
		update_option( self::OPTION_STATE, $state, false );

		// The handshake already returned the widget config; cache it now so the
		// first page view after connecting does not need another round trip.
		if ( isset( $data['widget'] ) && is_array( $data['widget'] ) ) {
			ConfigCache::store(
				array(
					'widget'   => $data['widget'],
					'messages' => array(),
					'website'  => $website,
				)
			);
		}

		\ChatPilot\Common\Logger::log( 'info', 'Chat Pilot connected successfully.', array( 'domain' => $state['domain'] ) );

		return array(
			'success' => true,
			'code'    => 'connected',
			'message' => __( 'Chat Pilot is connected.', 'chat-pilot' ),
			'state'   => $state,
		);
	}

	/**
	 * Lightweight connection check used by the dashboard.
	 *
	 * @return array Result array with 'success', 'code', 'message', 'health'.
	 */
	public static function health() {
		$result = Client::get( '/api/' . CHAT_PILOT_API_VERSION . '/site/health' );

		if ( empty( $result['success'] ) ) {
			$code = isset( $result['code'] ) ? $result['code'] : 'api_error';

			$state              = self::get_state();
			$state['connected'] = false;
			$state['code']      = $code;
			$state['checked_at']= current_time( 'mysql' );
			update_option( self::OPTION_STATE, $state, false );

			return array(
				'success' => false,
				'code'    => $code,
				'message' => self::friendly_message( $code, isset( $result['message'] ) ? $result['message'] : '' ),
				'health'  => array(),
			);
		}

		$state               = self::get_state();
		$state['connected']  = true;
		$state['code']       = 'connected';
		$state['checked_at'] = current_time( 'mysql' );
		update_option( self::OPTION_STATE, $state, false );

		return array(
			'success' => true,
			'code'    => 'connected',
			'message' => __( 'Connected', 'chat-pilot' ),
			'health'  => $result['data'],
		);
	}

	/**
	 * Tells Chat Pilot this site is disconnecting, then clears local state.
	 *
	 * @return array
	 */
	public static function disconnect() {
		if ( self::get_api_key() ) {
			Client::post( '/api/' . CHAT_PILOT_API_VERSION . '/site/disconnect', array() );
		}
		self::forget();
		\ChatPilot\Common\Logger::log( 'info', 'Chat Pilot disconnected.' );

		return array(
			'success' => true,
			'message' => __( 'Chat Pilot has been disconnected from this site.', 'chat-pilot' ),
		);
	}

	/**
	 * Deep link into the Chat Pilot dashboard for this website.
	 *
	 * @param string $section Optional sub-page, e.g. 'knowledge'.
	 * @return string
	 */
	public static function dashboard_url( $section = '' ) {
		$state = self::get_state();
		$base  = Client::base_url();

		if ( empty( $state['website_id'] ) ) {
			return $base . '/app';
		}

		$url = $base . '/app/websites/' . rawurlencode( $state['website_id'] );
		if ( $section ) {
			$url .= '/' . rawurlencode( $section );
		}
		return $url;
	}
}
