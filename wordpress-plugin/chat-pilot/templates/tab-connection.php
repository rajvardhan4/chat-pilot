<?php
/**
 * Connection tab.
 *
 * The one screen in WordPress that holds a secret. It accepts the Site API Key,
 * runs the handshake, and reports exactly which of the possible failures
 * occurred in plain language - never a raw API message or stack trace.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$cp_state     = \ChatPilot\Api\Connection::get_state();
$cp_connected = \ChatPilot\Api\Connection::is_connected();
$cp_has_key   = (bool) \ChatPilot\Api\Connection::get_api_key();
$cp_masked    = \ChatPilot\Api\Connection::masked_key();
$cp_messages  = \ChatPilot\Api\Connection::status_messages();
$cp_code      = isset( $cp_state['code'] ) ? $cp_state['code'] : '';

/**
 * A masked key field with a reveal button.
 *
 * Keys are pasted, misread and re-pasted more than any other field on this
 * screen, so it starts masked (shoulder surfing, screen shares) with one click
 * to check what actually landed in it.
 *
 * @param string $id          Input id.
 * @param string $label       Field label.
 * @param string $placeholder Placeholder text.
 */
if ( ! function_exists( 'cp_render_key_field' ) ) :
function cp_render_key_field( $id, $label, $placeholder ) {
	?>
	<div class="cp-form-group">
		<label class="cp-label" for="<?php echo esc_attr( $id ); ?>"><?php echo esc_html( $label ); ?></label>
		<span class="cp-secret-field">
			<?php
			/*
			 * autocomplete="new-password", not "off": browsers ignore "off" on
			 * password fields and will happily autofill a saved site password
			 * here, which then gets submitted as the Site API Key and rejected
			 * with an error that looks like the key is wrong.
			 */
			?>
			<input type="password" id="<?php echo esc_attr( $id ); ?>" class="cp-input"
			       placeholder="<?php echo esc_attr( $placeholder ); ?>" autocomplete="new-password" spellcheck="false">
			<button type="button" class="cp-eye" data-reveal="<?php echo esc_attr( $id ); ?>"
			        aria-pressed="false" aria-label="<?php esc_attr_e( 'Show key', 'chat-pilot' ); ?>">
				<svg class="cp-eye-on" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
				<svg class="cp-eye-off" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>
			</button>
		</span>
	</div>
	<?php
}
endif;
?>

<?php if ( ! $cp_has_key ) : ?>

	<div class="cp-card">
		<h2 class="cp-card-title"><?php esc_html_e( 'Connect Chat Pilot', 'chat-pilot' ); ?></h2>
		<p class="cp-description">
			<?php esc_html_e( 'Chat Pilot runs on the Chat Pilot Cloud platform. Sign in to your Chat Pilot account, open your website, and copy its Site API Key.', 'chat-pilot' ); ?>
		</p>

		<div class="cp-form" style="max-width: 640px;">
			<?php cp_render_key_field( 'cp-api-key', __( 'Site API Key', 'chat-pilot' ), 'cp_live_...' ); ?>
			<p class="cp-help-text"><?php esc_html_e( 'The key is stored on this server only. It is never sent to a browser.', 'chat-pilot' ); ?></p>

			<div id="cp-connect-error" class="cp-alert cp-alert-error" style="display:none;"></div>

			<button type="button" id="cp-connect-btn" class="cp-btn cp-btn-primary cp-btn-lg">
				<?php esc_html_e( 'Connect Chat Pilot', 'chat-pilot' ); ?>
			</button>
		</div>
	</div>

	<div class="cp-card">
		<h3 class="cp-card-title"><?php esc_html_e( 'Where do I find my key?', 'chat-pilot' ); ?></h3>
		<ol class="cp-description" style="line-height:2; padding-left:1.25rem;">
			<li><?php esc_html_e( 'Sign in to Chat Pilot Cloud.', 'chat-pilot' ); ?></li>
			<li><?php esc_html_e( 'Open the website you registered for this domain.', 'chat-pilot' ); ?></li>
			<li><?php esc_html_e( 'Go to the Connection tab and choose Generate key.', 'chat-pilot' ); ?></li>
			<li><?php esc_html_e( 'Copy the key immediately - it is shown once and cannot be retrieved later.', 'chat-pilot' ); ?></li>
			<li><?php esc_html_e( 'Paste it above and press Connect Chat Pilot.', 'chat-pilot' ); ?></li>
		</ol>
		<a class="cp-btn cp-btn-secondary" href="<?php echo esc_url( \ChatPilot\Api\Client::base_url() . '/app' ); ?>" target="_blank" rel="noopener noreferrer">
			<?php esc_html_e( 'Open Chat Pilot Cloud', 'chat-pilot' ); ?>
		</a>
	</div>

<?php else : ?>

	<div class="cp-card">
		<h2 class="cp-card-title">
			<?php esc_html_e( 'Connection Status', 'chat-pilot' ); ?>
			<span class="cp-badge-log <?php echo $cp_connected ? 'cp-badge-success' : 'cp-badge-error'; ?>">
				<?php echo esc_html( $cp_connected ? __( 'Connected', 'chat-pilot' ) : __( 'Not Connected', 'chat-pilot' ) ); ?>
			</span>
		</h2>

		<?php if ( ! $cp_connected && $cp_code ) : ?>
			<div class="cp-alert cp-alert-error">
				<?php echo esc_html( isset( $cp_messages[ $cp_code ] ) ? $cp_messages[ $cp_code ] : __( 'Chat Pilot could not verify this connection.', 'chat-pilot' ) ); ?>
			</div>
		<?php endif; ?>

		<div class="cp-info-list">
			<div class="cp-info-row">
				<span class="cp-info-label"><?php esc_html_e( 'Site API Key', 'chat-pilot' ); ?></span>
				<span class="cp-info-value"><code><?php echo esc_html( $cp_masked ); ?></code></span>
			</div>
			<div class="cp-info-row">
				<span class="cp-info-label"><?php esc_html_e( 'Website', 'chat-pilot' ); ?></span>
				<span class="cp-info-value"><?php echo esc_html( isset( $cp_state['website_name'] ) ? $cp_state['website_name'] : '—' ); ?></span>
			</div>
			<div class="cp-info-row">
				<span class="cp-info-label"><?php esc_html_e( 'Registered domain', 'chat-pilot' ); ?></span>
				<span class="cp-info-value"><?php echo esc_html( isset( $cp_state['domain'] ) ? $cp_state['domain'] : '—' ); ?></span>
			</div>
			<div class="cp-info-row">
				<span class="cp-info-label"><?php esc_html_e( 'This site', 'chat-pilot' ); ?></span>
				<span class="cp-info-value"><?php echo esc_html( wp_parse_url( home_url(), PHP_URL_HOST ) ); ?></span>
			</div>
			<div class="cp-info-row">
				<span class="cp-info-label"><?php esc_html_e( 'Account', 'chat-pilot' ); ?></span>
				<span class="cp-info-value"><?php echo esc_html( isset( $cp_state['account_name'] ) ? $cp_state['account_name'] : '—' ); ?></span>
			</div>
			<div class="cp-info-row">
				<span class="cp-info-label"><?php esc_html_e( 'Domain ownership', 'chat-pilot' ); ?></span>
				<span class="cp-info-value">
					<?php if ( ! empty( $cp_state['verified'] ) ) : ?>
						<span class="cp-badge-log cp-badge-success"><?php esc_html_e( 'Verified', 'chat-pilot' ); ?></span>
					<?php else : ?>
						<span class="cp-badge-log"><?php esc_html_e( 'Not verified', 'chat-pilot' ); ?></span>
					<?php endif; ?>
				</span>
			</div>
			<div class="cp-info-row">
				<span class="cp-info-label"><?php esc_html_e( 'Last checked', 'chat-pilot' ); ?></span>
				<span class="cp-info-value"><?php echo esc_html( isset( $cp_state['checked_at'] ) ? $cp_state['checked_at'] : '—' ); ?></span>
			</div>
		</div>

		<div class="cp-actions-row" style="margin-top:1.5rem;">
			<button type="button" id="cp-refresh-status-btn" class="cp-btn cp-btn-primary">
				<?php esc_html_e( 'Re-check connection', 'chat-pilot' ); ?>
			</button>
			<button type="button" id="cp-sync-config-btn" class="cp-btn cp-btn-secondary">
				<?php esc_html_e( 'Sync widget settings', 'chat-pilot' ); ?>
			</button>
			<a class="cp-btn cp-btn-secondary" href="<?php echo esc_url( \ChatPilot\Api\Connection::dashboard_url( 'connection' ) ); ?>" target="_blank" rel="noopener noreferrer">
				<?php esc_html_e( 'Manage in Chat Pilot', 'chat-pilot' ); ?>
			</a>
			<button type="button" id="cp-disconnect-btn" class="cp-btn cp-btn-danger">
				<?php esc_html_e( 'Disconnect', 'chat-pilot' ); ?>
			</button>
		</div>
	</div>

	<div class="cp-card">
		<h3 class="cp-card-title"><?php esc_html_e( 'Replace the Site API Key', 'chat-pilot' ); ?></h3>
		<p class="cp-description">
			<?php esc_html_e( 'If you rotated the key in Chat Pilot, paste the new one here. The old key stops working the moment you revoke it in the dashboard.', 'chat-pilot' ); ?>
		</p>
		<div class="cp-form" style="max-width:640px;">
			<?php cp_render_key_field( 'cp-api-key', __( 'New Site API Key', 'chat-pilot' ), 'cp_live_...' ); ?>
			<div id="cp-connect-error" class="cp-alert cp-alert-error" style="display:none;"></div>
			<button type="button" id="cp-connect-btn" class="cp-btn cp-btn-primary">
				<?php esc_html_e( 'Save and reconnect', 'chat-pilot' ); ?>
			</button>
		</div>
	</div>

	<div class="cp-card">
		<h3 class="cp-card-title"><?php esc_html_e( 'Ownership verification', 'chat-pilot' ); ?></h3>
		<p class="cp-description">
			<?php esc_html_e( 'When you connect, Chat Pilot asks this site to serve a one-time token so it can confirm you really control this domain. That endpoint is:', 'chat-pilot' ); ?>
		</p>
		<p><code><?php echo esc_html( home_url( '/wp-json/chat-pilot/v1/site-token' ) ); ?></code></p>
		<p class="cp-help-text">
			<?php esc_html_e( 'If your site is behind HTTP authentication, a firewall or a staging password, verification will show as unverified. The connection still works; only the ownership badge is affected.', 'chat-pilot' ); ?>
		</p>
	</div>

<?php endif; ?>
