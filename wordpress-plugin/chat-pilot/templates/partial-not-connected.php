<?php
/**
 * Shown at the top of any tab that needs a live connection to say anything.
 *
 * Every tab stays reachable whether or not this site is connected. A tab that
 * bounced you back to Connection read as a dead link - the click did nothing
 * visible - so the tab opens and explains itself instead.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( \ChatPilot\Api\Connection::is_connected() ) {
	return;
}

$cp_has_key = (bool) \ChatPilot\Api\Connection::get_api_key();
?>

<div class="cp-card cp-card-empty">
	<h2 class="cp-card-title">
		<?php esc_html_e( 'Not connected yet', 'chat-pilot' ); ?>
		<span class="cp-badge-log <?php echo $cp_has_key ? 'cp-badge-error' : 'cp-badge-warning'; ?>">
			<?php echo esc_html( $cp_has_key ? __( 'Connection problem', 'chat-pilot' ) : __( 'No key', 'chat-pilot' ) ); ?>
		</span>
	</h2>

	<p class="cp-description">
		<?php if ( $cp_has_key ) : ?>
			<?php esc_html_e( 'A Site API Key is saved, but Chat Pilot could not confirm the connection. Nothing on this screen is live until that is fixed.', 'chat-pilot' ); ?>
		<?php else : ?>
			<?php esc_html_e( 'This screen shows what Chat Pilot Cloud is sending to your website. Add your Site API Key and the numbers below start filling in.', 'chat-pilot' ); ?>
		<?php endif; ?>
	</p>

	<a class="cp-btn cp-btn-primary" href="<?php echo esc_url( admin_url( 'admin.php?page=chat-pilot&tab=connection' ) ); ?>">
		<?php echo esc_html( $cp_has_key ? __( 'Check the connection', 'chat-pilot' ) : __( 'Add your Site API Key', 'chat-pilot' ) ); ?>
	</a>
</div>
