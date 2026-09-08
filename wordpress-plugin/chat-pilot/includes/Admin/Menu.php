<?php
namespace ChatPilot\Admin;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class Menu
 * Registers the Chat Pilot admin menu.
 *
 * Same position, same label, same icon as v1, so the plugin sits exactly where
 * existing users expect to find it.
 */
class Menu {

	/**
	 * Hooks the menu.
	 */
	public function __construct() {
		add_action( 'admin_menu', array( $this, 'register_admin_pages' ) );
		add_action( 'admin_notices', array( $this, 'connection_notice' ) );
		add_filter( 'plugin_action_links_' . CHAT_PILOT_BASENAME, array( $this, 'action_links' ) );
	}

	/**
	 * Adds the top-level page.
	 */
	public function register_admin_pages() {
		// A flat single-colour mark: wp-admin recolours the icon per state, so a
		// full-colour logo would fight the admin theme rather than match it.
		$svg_icon = 'data:image/svg+xml;base64,' . base64_encode(
			'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="currentColor">' .
			'<path d="M12 3.2c-4.6 0-8.3 2.9-8.3 6.5 0 2 1.1 3.8 2.9 5v3.1c0 .5.6.8 1 .5l2.7-1.9c.5.1 1.1.1 1.7.1 4.6 0 8.3-2.9 8.3-6.5S16.6 3.2 12 3.2z"/>' .
			'<circle cx="8.6" cy="9.7" r="1.15"/><circle cx="12" cy="9.7" r="1.15"/><circle cx="15.4" cy="9.7" r="1.15"/>' .
			'</svg>'
		);

		add_menu_page(
			esc_html__( 'Chat Pilot', 'chat-pilot' ),
			esc_html__( 'Chat Pilot', 'chat-pilot' ),
			apply_filters( 'chat_pilot_admin_capability', 'manage_options' ),
			'chat-pilot',
			array( $this, 'render_dashboard' ),
			$svg_icon,
			59
		);
	}

	/**
	 * Renders the dashboard shell.
	 */
	public function render_dashboard() {
		$plugin = \ChatPilot\Core\Plugin::instance();
		$plugin->tabs->render_dashboard_view();
	}

	/**
	 * Nudges the administrator when the plugin is installed but not connected.
	 */
	public function connection_notice() {
		if ( ! current_user_can( apply_filters( 'chat_pilot_admin_capability', 'manage_options' ) ) ) {
			return;
		}

		$screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;
		if ( $screen && 'toplevel_page_chat-pilot' === $screen->id ) {
			return; // The page itself already says so, loudly.
		}

		if ( \ChatPilot\Api\Connection::is_connected() ) {
			return;
		}

		$url = admin_url( 'admin.php?page=chat-pilot&tab=connection' );
		?>
		<div class="notice notice-warning is-dismissible">
			<p>
				<strong><?php esc_html_e( 'Chat Pilot is not connected yet.', 'chat-pilot' ); ?></strong>
				<?php esc_html_e( 'Add your Site API Key to activate the chat widget on this site.', 'chat-pilot' ); ?>
				<a href="<?php echo esc_url( $url ); ?>"><?php esc_html_e( 'Connect Chat Pilot', 'chat-pilot' ); ?></a>
			</p>
		</div>
		<?php
	}

	/**
	 * Adds a Settings link on the Plugins screen.
	 *
	 * @param array $links Existing links.
	 * @return array
	 */
	public function action_links( $links ) {
		$url  = admin_url( 'admin.php?page=chat-pilot&tab=connection' );
		$link = '<a href="' . esc_url( $url ) . '">' . esc_html__( 'Connection', 'chat-pilot' ) . '</a>';
		array_unshift( $links, $link );
		return $links;
	}
}
