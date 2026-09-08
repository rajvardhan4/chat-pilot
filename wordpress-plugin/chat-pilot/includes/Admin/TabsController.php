<?php
namespace ChatPilot\Admin;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class TabsController
 * Routes the admin tabs.
 *
 * The strip carries only the screens this WordPress install actually owns:
 * whether it is connected, whether the widget may render and where, and the
 * local settings and log.
 *
 * Earlier builds also carried AI Providers, Knowledge Base, AI Instructions,
 * Forms, Conversations and Analytics tabs. Those screens never edited anything
 * here - each was a page of copy plus a link into Chat Pilot Cloud, which owns
 * that data. Six tabs of signposting made the plugin look like it did work it
 * does not do, so the signposts collapsed into one panel on the Dashboard.
 * Nothing was removed from the product: every one of those destinations is
 * still one click away, from a place that does not pretend to be the editor.
 */
class TabsController {

	/**
	 * Tab key => label.
	 *
	 * @var array
	 */
	private $tabs = array();

	/**
	 * Builds the tab map.
	 */
	public function __construct() {
		$this->tabs = array(
			'dashboard'  => esc_html__( 'Dashboard', 'chat-pilot' ),
			'connection' => esc_html__( 'Connection', 'chat-pilot' ),
			'widget'     => esc_html__( 'Chat Widget', 'chat-pilot' ),
			'settings'   => esc_html__( 'Settings', 'chat-pilot' ),
		);
	}

	/**
	 * The Chat Pilot Cloud screens that own the data this plugin only displays.
	 *
	 * Rendered as a link panel on the Dashboard: label => portal section.
	 *
	 * @return array
	 */
	public function cloud_destinations() {
		return array(
			'providers'     => esc_html__( 'AI Providers', 'chat-pilot' ),
			'knowledge'     => esc_html__( 'Knowledge Base', 'chat-pilot' ),
			'instructions'  => esc_html__( 'AI Instructions', 'chat-pilot' ),
			'widget'        => esc_html__( 'Widget Appearance', 'chat-pilot' ),
			'forms'         => esc_html__( 'Forms &amp; Leads', 'chat-pilot' ),
			'conversations' => esc_html__( 'Conversations', 'chat-pilot' ),
			'analytics'     => esc_html__( 'Analytics', 'chat-pilot' ),
		);
	}

	/**
	 * Currently selected tab.
	 *
	 * @return string
	 */
	public function get_active_tab() {
		$connected = (bool) \ChatPilot\Api\Connection::get_api_key();

		// With no key the useful landing screen is Connection, so that is where
		// the menu item goes. Every tab stays reachable from there, though:
		// bouncing a click back to Connection made the tab strip look broken -
		// the tab simply appeared not to respond.
		$default = $connected ? 'dashboard' : 'connection';

		if ( ! isset( $_GET['tab'] ) ) {
			return $default;
		}

		$tab = sanitize_key( wp_unslash( $_GET['tab'] ) );

		return array_key_exists( $tab, $this->tabs ) ? $tab : $default;
	}

	/**
	 * All navigation tabs.
	 *
	 * @return array
	 */
	public function get_tabs() {
		return $this->tabs;
	}

	/**
	 * Renders the shell and the active tab.
	 */
	public function render_dashboard_view() {
		if ( ! current_user_can( apply_filters( 'chat_pilot_admin_capability', 'manage_options' ) ) ) {
			wp_die( esc_html__( 'You do not have permission to view this page.', 'chat-pilot' ) );
		}

		$active_tab = $this->get_active_tab();
		$tabs       = $this->get_tabs();
		$controller = $this;

		$shell = CHAT_PILOT_PATH . 'templates/admin-dashboard.php';
		if ( file_exists( $shell ) ) {
			include $shell;
		} else {
			wp_die( esc_html__( 'Dashboard template could not be loaded.', 'chat-pilot' ) );
		}
	}
}
