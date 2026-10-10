<?php
namespace ChatPilot\Api;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class Client
 * Signed HTTP client for Chat Pilot Cloud.
 *
 * Every request carries:
 *
 *   X-Chat-Pilot-Key        the Site API Key
 *   X-Chat-Pilot-Timestamp  unix seconds
 *   X-Chat-Pilot-Nonce      32 random hex characters, unique per request
 *   X-Chat-Pilot-Signature  hex HMAC-SHA256(key, canonical)
 *   X-Chat-Pilot-Site       this site's home URL
 *
 * canonical = METHOD "\n" PATH "\n" TIMESTAMP "\n" NONCE "\n" sha256hex(body)
 *
 * PATH is the full request path with no query string. The body hash covers the
 * exact bytes sent, so a proxy cannot alter the payload, and the timestamp plus
 * nonce make a captured request unusable a second time.
 *
 * The key never appears in a URL, a query string or a log line.
 */
class Client {

	/**
	 * Result shape returned by every call.
	 *
	 * array(
	 *   'success'  => bool,
	 *   'status'   => int      HTTP status (0 on transport failure)
	 *   'data'     => array    decoded `data` payload on success
	 *   'code'     => string   machine-readable error code on failure
	 *   'message'  => string   user-safe message on failure
	 *   'fields'   => array    per-field validation errors, when present
	 * )
	 */

	/**
	 * Base URL of the Chat Pilot Cloud install.
	 *
	 * Precedence, highest first:
	 *
	 *  1. CHAT_PILOT_API_URL defined in wp-config.php. A deliberate server-level
	 *     pin, so nobody with only wp-admin access can redirect this site's
	 *     traffic - including its signed requests - to another host.
	 *  2. The Cloud URL saved on the Connection tab, for staging and self-hosted
	 *     deployments where wp-config.php is not the right place to put it.
	 *  3. The endpoint this build ships with.
	 *
	 * @return string
	 */
	public static function base_url() {
		$url = self::default_base_url();

		if ( ! self::is_pinned() ) {
			$saved = self::configured_base_url();
			if ( '' !== $saved ) {
				if ( false !== strpos( $saved, 'palevioletred-louse-364639.hostingersite.com' ) ) {
					$saved = 'https://appchatpilot.vercel.app';
				}
				$url = $saved;
			}
		}

		$url = apply_filters( 'chat_pilot_api_url', $url );
		return untrailingslashit( trim( (string) $url ) );
	}

	/**
	 * Whether wp-config.php pinned the endpoint.
	 *
	 * @return bool
	 */
	public static function is_pinned() {
		return defined( 'CHAT_PILOT_API_URL_PINNED' ) && CHAT_PILOT_API_URL_PINNED;
	}

	/**
	 * The endpoint this build ships with, or the wp-config.php pin.
	 *
	 * @return string
	 */
	public static function default_base_url() {
		return untrailingslashit( trim( (string) CHAT_PILOT_API_URL ) );
	}

	/**
	 * The Cloud URL an administrator saved on the Connection tab.
	 *
	 * Only http and https are accepted. Anything else is treated as unset rather
	 * than signing a request to a scheme we do not control.
	 *
	 * @return string Empty string when unset or unusable.
	 */
	public static function configured_base_url() {
		$plugin = \ChatPilot\Core\Plugin::instance();
		if ( ! $plugin || ! isset( $plugin->settings ) ) {
			return '';
		}

		$saved = untrailingslashit( trim( (string) $plugin->settings->get( 'cloud.api_url', '' ) ) );
		if ( '' === $saved ) {
			return '';
		}

		$scheme = wp_parse_url( $saved, PHP_URL_SCHEME );
		if ( ! in_array( $scheme, array( 'http', 'https' ), true ) ) {
			return '';
		}

		return $saved;
	}

	/**
	 * Performs a signed GET.
	 *
	 * @param string $path    API path, e.g. '/api/v1/site/config'.
	 * @param string $api_key Optional key override (used during connection).
	 * @return array Result array.
	 */
	public static function get( $path, $api_key = '' ) {
		return self::request( 'GET', $path, null, $api_key );
	}

	/**
	 * Performs a signed POST.
	 *
	 * @param string $path    API path.
	 * @param array  $payload JSON body.
	 * @param string $api_key Optional key override (used during connection).
	 * @return array Result array.
	 */
	public static function post( $path, array $payload = array(), $api_key = '' ) {
		return self::request( 'POST', $path, $payload, $api_key );
	}

	/**
	 * Signs and dispatches a request.
	 *
	 * @param string     $method  HTTP method.
	 * @param string     $path    API path (no query string).
	 * @param array|null $payload JSON body, or null for no body.
	 * @param string     $api_key Optional key override.
	 * @return array Result array.
	 */
	private static function request( $method, $path, $payload, $api_key = '' ) {
		$key = $api_key ? trim( $api_key ) : Connection::get_api_key();

		if ( empty( $key ) ) {
			return self::failure( 'not_connected', __( 'Chat Pilot is not connected yet. Add your Site API Key to get started.', 'chat-pilot' ) );
		}

		$body = ( null === $payload ) ? '' : wp_json_encode( $payload );
		if ( false === $body ) {
			return self::failure( 'encode_failed', __( 'Chat Pilot could not prepare that request.', 'chat-pilot' ) );
		}

		$timestamp = (string) time();
		$nonce     = self::nonce();
		$canonical = implode(
			"\n",
			array(
				strtoupper( $method ),
				$path,
				$timestamp,
				$nonce,
				hash( 'sha256', $body ),
			)
		);
		$signature = hash_hmac( 'sha256', $canonical, $key );

		$args = array(
			'method'      => strtoupper( $method ),
			'timeout'     => (int) apply_filters( 'chat_pilot_request_timeout', 20 ),
			'redirection' => 0,
			'httpversion' => '1.1',
			'sslverify'   => true,
			'user-agent'  => 'ChatPilot-WP/' . CHAT_PILOT_VERSION . '; ' . home_url(),
			'headers'     => array(
				'Accept'                  => 'application/json',
				'X-Chat-Pilot-Key'        => $key,
				'X-Chat-Pilot-Timestamp'  => $timestamp,
				'X-Chat-Pilot-Nonce'      => $nonce,
				'X-Chat-Pilot-Signature'  => $signature,
				'X-Chat-Pilot-Site'       => home_url(),
				'X-Chat-Pilot-Plugin'     => CHAT_PILOT_VERSION,
			),
		);

		if ( '' !== $body ) {
			$args['headers']['Content-Type'] = 'application/json; charset=utf-8';
			$args['body']                    = $body;
		}

		$response = wp_remote_request( self::base_url() . $path, $args );

		if ( is_wp_error( $response ) ) {
			\ChatPilot\Common\Logger::log(
				'error',
				'Chat Pilot API transport failure.',
				array(
					'path'  => $path,
					'error' => $response->get_error_message(),
				)
			);
			return self::failure(
				'transport_error',
				__( 'Chat Pilot could not be reached. Please check your connection and try again.', 'chat-pilot' ),
				0
			);
		}

		$status = (int) wp_remote_retrieve_response_code( $response );
		$raw    = wp_remote_retrieve_body( $response );
		$parsed = json_decode( $raw, true );

		if ( ! is_array( $parsed ) ) {
			\ChatPilot\Common\Logger::log(
				'error',
				'Chat Pilot API returned a malformed response.',
				array(
					'path'   => $path,
					'status' => $status,
				)
			);
			return self::failure(
				'malformed_response',
				__( 'Chat Pilot returned an unexpected response. Please try again in a moment.', 'chat-pilot' ),
				$status
			);
		}

		if ( $status >= 200 && $status < 300 && ! empty( $parsed['ok'] ) ) {
			return array(
				'success' => true,
				'status'  => $status,
				'data'    => isset( $parsed['data'] ) && is_array( $parsed['data'] ) ? $parsed['data'] : array(),
			);
		}

		$error   = isset( $parsed['error'] ) && is_array( $parsed['error'] ) ? $parsed['error'] : array();
		$code    = isset( $error['code'] ) ? sanitize_key( $error['code'] ) : 'api_error';
		$message = isset( $error['message'] ) ? sanitize_text_field( $error['message'] ) : '';

		if ( '' === $message ) {
			$message = __( 'Chat Pilot could not complete that request.', 'chat-pilot' );
		}

		\ChatPilot\Common\Logger::log(
			'warning',
			'Chat Pilot API rejected a request.',
			array(
				'path'   => $path,
				'status' => $status,
				'code'   => $code,
			)
		);

		return array(
			'success' => false,
			'status'  => $status,
			'code'    => $code,
			'message' => $message,
			'fields'  => isset( $error['fields'] ) && is_array( $error['fields'] ) ? $error['fields'] : array(),
		);
	}

	/**
	 * Builds a cryptographically random nonce.
	 *
	 * @return string 32 hex characters.
	 */
	private static function nonce() {
		if ( function_exists( 'random_bytes' ) ) {
			try {
				return bin2hex( random_bytes( 16 ) );
			} catch ( \Exception $e ) {
				// Fall through to the WordPress helper below.
				unset( $e );
			}
		}
		return substr( hash( 'sha256', wp_generate_password( 64, true, true ) . microtime( true ) ), 0, 32 );
	}

	/**
	 * Builds a failure result.
	 *
	 * @param string $code    Machine-readable code.
	 * @param string $message User-safe message.
	 * @param int    $status  HTTP status, 0 for transport failures.
	 * @return array
	 */
	private static function failure( $code, $message, $status = 0 ) {
		return array(
			'success' => false,
			'status'  => $status,
			'code'    => $code,
			'message' => $message,
			'fields'  => array(),
		);
	}
}
