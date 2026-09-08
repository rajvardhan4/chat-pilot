<?php
namespace ChatPilot\Admin;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class Assets
 * Loads admin CSS and JS on the Chat Pilot page only.
 *
 * The stylesheet is the v1 file unchanged, so the admin screens keep the same
 * dark glassmorphic identity. The localised payload is much smaller than v1:
 * no provider data, no model lists, no form definitions - and, critically, no
 * Site API Key.
 */
class Assets {

	/**
	 * Hooks the enqueue.
	 */
	public function __construct() {
		add_action( 'admin_enqueue_scripts', array( $this, 'enqueue_admin_assets' ) );
	}

	/**
	 * Enqueues assets for the plugin page.
	 *
	 * @param string $hook Current admin page hook.
	 */
	public function enqueue_admin_assets( $hook ) {
		if ( 'toplevel_page_chat-pilot' !== $hook ) {
			return;
		}

		$plugin   = \ChatPilot\Core\Plugin::instance();
		$version  = CHAT_PILOT_VERSION;
		$dev_mode = $plugin->settings->get( 'developer.dev_mode', false );

		if ( $dev_mode ) {
			$version .= '.' . time();
		}

		wp_enqueue_style(
			'chat-pilot-admin-css',
			CHAT_PILOT_URL . 'assets/css/admin-style.css',
			array(),
			$version,
			'all'
		);

		wp_enqueue_script(
			'chat-pilot-admin-js',
			CHAT_PILOT_URL . 'assets/js/admin-script.js',
			array( 'jquery' ),
			$version,
			true
		);

		$state = \ChatPilot\Api\Connection::get_state();

		wp_localize_script(
			'chat-pilot-admin-js',
			'chatPilotAdmin',
			array(
				'ajaxUrl'      => admin_url( 'admin-ajax.php' ),
				// Nonce only. The Site API Key is never localised.
				'nonce'        => wp_create_nonce( 'chat_pilot_admin_nonce' ),
				'connected'    => \ChatPilot\Api\Connection::is_connected(),
				'dashboardUrl' => \ChatPilot\Api\Connection::dashboard_url(),
				'websiteName'  => isset( $state['website_name'] ) ? $state['website_name'] : '',
				'devMode'      => (bool) $dev_mode,
				'i18n'         => array(
					'connecting'   => esc_html__( 'Connecting…', 'chat-pilot' ),
					'connected'    => esc_html__( 'Connected', 'chat-pilot' ),
					'checking'     => esc_html__( 'Checking…', 'chat-pilot' ),
					'saving'       => esc_html__( 'Saving…', 'chat-pilot' ),
					'syncing'      => esc_html__( 'Syncing…', 'chat-pilot' ),
					'confirmReset' => esc_html__( 'Disconnect Chat Pilot from this website? The chat widget will stop appearing until you reconnect.', 'chat-pilot' ),
					'genericError' => esc_html__( 'Something went wrong. Please try again.', 'chat-pilot' ),
					'networkError' => esc_html__( 'Could not reach this site. Check your connection and try again.', 'chat-pilot' ),
					'showKey'      => esc_html__( 'Show key', 'chat-pilot' ),
					'hideKey'      => esc_html__( 'Hide key', 'chat-pilot' ),
				),
			)
		);
	}
}
