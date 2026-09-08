<?php
/**
 * Chat Pilot admin shell.
 *
 * Same wrapper, header, brand lockup and tab strip as v1. Only the status pill
 * changed: it now reflects the live connection to Chat Pilot Cloud rather than
 * a local "Core Active" flag.
 *
 * @var string                              $active_tab
 * @var array                               $tabs
 * @var \ChatPilot\Admin\TabsController      $controller
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$active_tab = isset( $active_tab ) ? $active_tab : 'dashboard';
$tabs       = isset( $tabs ) ? $tabs : array();

$cp_connected = \ChatPilot\Api\Connection::is_connected();
$cp_state     = \ChatPilot\Api\Connection::get_state();
$cp_has_key   = (bool) \ChatPilot\Api\Connection::get_api_key();

if ( $cp_connected ) {
	$cp_badge_class = '';
	$cp_badge_text  = esc_html__( 'Connected to Chat Pilot Cloud', 'chat-pilot' );
} elseif ( $cp_has_key ) {
	$cp_badge_class = 'cp-badge-error';
	$cp_badge_text  = esc_html__( 'Connection Problem', 'chat-pilot' );
} else {
	$cp_badge_class = 'cp-badge-warning';
	$cp_badge_text  = esc_html__( 'Not Connected', 'chat-pilot' );
}
?>

<div id="chat-pilot-container">
	<div id="cp-notification" class="cp-alert" style="display: none; position: fixed; top: 50px; right: 30px; z-index: 9999; box-shadow: 0 10px 25px rgba(0,0,0,0.4); max-width: 350px;">
		<span class="cp-notification-text"></span>
		<button type="button" class="cp-notification-close" style="background:none; border:none; color:inherit; font-size:16px; cursor:pointer; margin-left:auto; font-weight:700;">&times;</button>
	</div>

	<header class="cp-header">
		<div class="cp-logo">
			<h1>CHAT PILOT</h1>
			<div class="cp-brand-sub">
				<span><?php esc_html_e( 'by', 'chat-pilot' ); ?></span> <strong>Local Marketing Geeks</strong>
			</div>
			<p><?php esc_html_e( 'Site Connector for Chat Pilot Cloud', 'chat-pilot' ); ?></p>
		</div>
		<div class="cp-status-badge <?php echo esc_attr( $cp_badge_class ); ?>">
			<span class="cp-status-dot"></span>
			<span class="cp-status-text"><?php echo esc_html( $cp_badge_text ); ?></span>
		</div>
	</header>

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

	<main class="cp-tab-content">
		<?php
		$cp_tab_file = CHAT_PILOT_PATH . 'templates/tab-' . $active_tab . '.php';

		if ( file_exists( $cp_tab_file ) ) {
			include $cp_tab_file;
		} else {
			echo '<div class="cp-alert cp-alert-error">' . esc_html__( 'That screen could not be loaded.', 'chat-pilot' ) . '</div>';
		}
		?>
	</main>
</div>
