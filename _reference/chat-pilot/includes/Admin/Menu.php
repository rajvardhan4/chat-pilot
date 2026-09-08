<?php
namespace ChatPilot\Admin;

// Prevent direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class Menu
 * Manages the WordPress admin menu entries for Chat Pilot.
 */
class Menu {

	/**
	 * Constructor.
	 * Hooks into the admin menu lifecycle.
	 */
	public function __construct() {
		add_action( 'admin_menu', array( $this, 'register_admin_pages' ) );
	}

	/**
	 * Registers the top-level admin menu and page hooks.
	 */
	public function register_admin_pages() {
		// Custom SVG icon base64 encoded (a sleek pilot navigation compass/chat bubble).
		$svg_icon = 'data:image/svg+xml;base64,' . base64_encode(
			'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="%2306b6d4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path><circle cx="12" cy="10" r="3"></circle></svg>'
		);

		add_menu_page(
			esc_html__( 'Chat Pilot', 'chat-pilot' ),
			esc_html__( 'Chat Pilot', 'chat-pilot' ),
			'manage_options',
			'chat-pilot',
			array( $this, 'render_dashboard' ),
			$svg_icon,
			59 // Position just below WooCommerce/Jetpack or standard post elements.
		);
	}

	/**
	 * Renders the main dashboard shell.
	 */
	public function render_dashboard() {
		// Delegates template routing and rendering to the TabsController.
		$plugin = \ChatPilot\Core\Plugin::instance();
		$plugin->tabs->render_dashboard_view();
	}
}
