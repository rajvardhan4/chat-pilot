<?php
namespace ChatPilot\Admin;

// Prevent direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class TabsController
 * Routes administrative actions and sub-view loadings based on selected dashboard tabs.
 */
class TabsController {

	/**
	 * Map of registered dashboard navigation tabs.
	 *
	 * @var array
	 */
	private $tabs = array();

	/**
	 * Constructor.
	 * Registers default administrative tabs.
	 */
	public function __construct() {
		$this->tabs = array(
			'dashboard'     => esc_html__( 'Dashboard', 'chat-pilot' ),
			'providers'     => esc_html__( 'AI Providers', 'chat-pilot' ),
			'kb'            => esc_html__( 'Knowledge Base', 'chat-pilot' ),
			'instructions'  => esc_html__( 'AI Instructions', 'chat-pilot' ),
			'playground'    => esc_html__( 'Developer Chat Preview', 'chat-pilot' ),
			'widget'        => esc_html__( 'Chat Widget', 'chat-pilot' ),
			'forms'         => esc_html__( 'Forms', 'chat-pilot' ),
			'conversations' => esc_html__( 'Conversations', 'chat-pilot' ),
			'analytics'     => esc_html__( 'Analytics', 'chat-pilot' ),
			'settings'      => esc_html__( 'Settings', 'chat-pilot' ),
			'support'       => esc_html__( 'Support', 'chat-pilot' ),
		);
	}

	/**
	 * Determines the currently active tab.
	 * Includes support for direct routing of utility tabs (security, database).
	 *
	 * @return string Tab key token.
	 */
	public function get_active_tab() {
		$tab = isset( $_GET['tab'] ) ? sanitize_key( wp_unslash( $_GET['tab'] ) ) : 'dashboard';
		
		// Consolidate navigation tabs and hidden utility tabs.
		$allowed_tabs = array_merge(
			$this->tabs,
			array(
				'security'   => esc_html__( 'Security Audit', 'chat-pilot' ),
				'database'   => esc_html__( 'Database Logs', 'chat-pilot' ),
			)
		);
		
		return array_key_exists( $tab, $allowed_tabs ) ? $tab : 'dashboard';
	}

	/**
	 * Retrieves the primary navigation tabs.
	 *
	 * @return array Multi-dimensional array of tabs labels.
	 */
	public function get_tabs() {
		return $this->tabs;
	}

	/**
	 * Triggers layout injection of the wrapper templates.
	 */
	public function render_dashboard_view() {
		$active_tab = $this->get_active_tab();
		$tabs       = $this->get_tabs();

		// Load main wrapper dashboard template.
		$shell_path = CHAT_PILOT_PATH . 'templates/admin-dashboard.php';
		if ( file_exists( $shell_path ) ) {
			include $shell_path;
		} else {
			wp_die( esc_html__( 'Dashboard wrapper template not found.', 'chat-pilot' ) );
		}
	}
}
