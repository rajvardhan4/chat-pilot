<?php
namespace ChatPilot\Core;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class Lifecycle
 * Activation and deactivation.
 *
 * There are no custom tables any more. Knowledge, conversations, leads and
 * analytics all live in Chat Pilot Cloud, so activation only has to check the
 * environment and seed a couple of local options.
 */
class Lifecycle {

	/**
	 * Activation routine.
	 */
	public static function activate() {
		self::verify_compatibility();

		$repository = new \ChatPilot\Settings\Repository();
		$repository->initialize_defaults();

		// Mint the ownership token the SaaS will ask this site to echo back.
		\ChatPilot\Api\Connection::site_token();

		// Make the REST route available immediately.
		flush_rewrite_rules();
	}

	/**
	 * Deactivation routine. Local state only: the Site API Key is left in place
	 * so reactivating does not force the customer to reconnect.
	 */
	public static function deactivate() {
		\ChatPilot\Api\ConfigCache::flush();
		flush_rewrite_rules();
	}

	/**
	 * Refuses to activate on an unsupported environment.
	 */
	private static function verify_compatibility() {
		$min_php = '7.4';
		if ( version_compare( PHP_VERSION, $min_php, '<' ) ) {
			deactivate_plugins( CHAT_PILOT_BASENAME );
			wp_die(
				sprintf(
					/* translators: 1: minimum PHP version, 2: current PHP version */
					esc_html__( 'Chat Pilot requires PHP %1$s or greater. This server runs PHP %2$s.', 'chat-pilot' ),
					esc_html( $min_php ),
					esc_html( PHP_VERSION )
				),
				esc_html__( 'Plugin Activation Error', 'chat-pilot' ),
				array( 'back_link' => true )
			);
		}

		$min_wp = '6.0';
		global $wp_version;
		if ( version_compare( $wp_version, $min_wp, '<' ) ) {
			deactivate_plugins( CHAT_PILOT_BASENAME );
			wp_die(
				sprintf(
					/* translators: 1: minimum WordPress version, 2: current version */
					esc_html__( 'Chat Pilot requires WordPress %1$s or greater. This site runs %2$s.', 'chat-pilot' ),
					esc_html( $min_wp ),
					esc_html( $wp_version )
				),
				esc_html__( 'Plugin Activation Error', 'chat-pilot' ),
				array( 'back_link' => true )
			);
		}

		// The plugin is useless without outbound HTTPS.
		if ( ! function_exists( 'hash_hmac' ) ) {
			deactivate_plugins( CHAT_PILOT_BASENAME );
			wp_die(
				esc_html__( 'Chat Pilot requires the PHP hash extension to sign requests securely.', 'chat-pilot' ),
				esc_html__( 'Plugin Activation Error', 'chat-pilot' ),
				array( 'back_link' => true )
			);
		}
	}
}
