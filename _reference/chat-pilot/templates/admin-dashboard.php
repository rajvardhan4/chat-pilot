<?php
/**
 * Chat Pilot Dashboard Shell Wrapper Template
 */

// Prevent direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

// Ensure active variables are set.
$active_tab = isset( $active_tab ) ? $active_tab : 'general';
$tabs       = isset( $tabs ) ? $tabs : array();
$dev_mode   = false;

$plugin = \ChatPilot\Core\Plugin::instance();
if ( isset( $plugin->settings ) ) {
	$dev_mode = $plugin->settings->get( 'general.dev_mode', false );
}
?>

<div id="chat-pilot-container">
	<!-- Dynamic sliding notifications -->
	<div id="cp-notification" class="cp-alert" style="display: none; position: fixed; top: 50px; right: 30px; z-index: 9999; box-shadow: 0 10px 25px rgba(0,0,0,0.4); max-width: 350px;">
		<span class="cp-notification-text"></span>
		<button type="button" class="cp-notification-close" style="background:none; border:none; color:inherit; font-size:16px; cursor:pointer; margin-left:auto; font-weight:700;">&times;</button>
	</div>

	<!-- Header Panel -->
	<header class="cp-header">
		<div class="cp-logo">
			<h1>CHAT PILOT</h1>
			<div class="cp-brand-sub">
				<span>by</span> <strong>Local Marketing Geeks</strong>
			</div>
			<p><?php esc_html_e( 'Control Center & Core System Management', 'chat-pilot' ); ?></p>
		</div>
		<div class="cp-status-badge <?php echo $dev_mode ? 'dev-active' : ''; ?>">
			<span class="cp-status-dot"></span>
			<span class="cp-status-text">
				<?php echo $dev_mode ? esc_html__( 'Developer Active', 'chat-pilot' ) : esc_html__( 'Core Active', 'chat-pilot' ); ?>
			</span>
		</div>
	</header>

	<!-- Tabs Navigation -->
	<nav class="cp-tabs-nav">
		<?php foreach ( $tabs as $key => $label ) : ?>
			<?php
			$tab_url = add_query_arg(
				array(
					'page' => 'chat-pilot',
					'tab'  => $key,
				),
				admin_url( 'admin.php' )
			);
			$active_class = ( $active_tab === $key ) ? 'active' : '';
			?>
			<a href="<?php echo esc_url( $tab_url ); ?>" class="cp-tab-link <?php echo esc_attr( $active_class ); ?>">
				<?php echo esc_html( $label ); ?>
			</a>
		<?php endforeach; ?>
	</nav>

	<!-- Tab Content Area -->
	<main class="cp-tab-content">
		<?php
		$tab_file = CHAT_PILOT_PATH . 'templates/tab-' . $active_tab . '.php';
		if ( file_exists( $tab_file ) ) {
			include $tab_file;
		} else {
			echo '<div class="cp-alert cp-alert-error">' . esc_html__( 'Selected tab template could not be loaded.', 'chat-pilot' ) . '</div>';
		}
		?>
	</main>
</div>
