<?php
/**
 * Settings tab.
 *
 * WordPress-side settings only. There is deliberately no AI provider, model,
 * prompt or fallback configuration here: v1 allowed Settings to shadow the
 * provider configuration, which is how a site ended up disagreeing with its own
 * engine. Those controls now have exactly one home, in Chat Pilot Cloud.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$cp_plugin  = \ChatPilot\Core\Plugin::instance();
$cp_logging = (bool) $cp_plugin->settings->get( 'logging.enabled', true );
$cp_dev     = (bool) $cp_plugin->settings->get( 'developer.dev_mode', false );
$cp_enable  = (bool) $cp_plugin->settings->get( 'general.enable_plugin', true );
$cp_hide    = (bool) $cp_plugin->settings->get( 'display.hide_for_admins', false );
$cp_mode    = (string) $cp_plugin->settings->get( 'display.mode', 'all' );
$cp_rules   = (string) $cp_plugin->settings->get( 'display.rules', '' );
$cp_log     = \ChatPilot\Common\Logger::recent( 40 );
?>

<div class="cp-card">
	<h2 class="cp-card-title"><?php esc_html_e( 'Plugin Settings', 'chat-pilot' ); ?></h2>
	<p class="cp-description">
		<?php esc_html_e( 'Everything that shapes an answer - provider, model, knowledge, instructions, widget appearance and forms - is configured in Chat Pilot Cloud. What remains here is how this WordPress site behaves.', 'chat-pilot' ); ?>
	</p>

	<form id="cp-settings-form" class="cp-form">
		<div class="cp-form-group">
			<label class="cp-checkbox-label">
				<input type="checkbox" name="enable_plugin" class="cp-checkbox" <?php checked( $cp_enable ); ?>>
				<span><?php esc_html_e( 'Enable Chat Pilot on this website', 'chat-pilot' ); ?></span>
			</label>
		</div>

		<div class="cp-form-group">
			<label class="cp-checkbox-label">
				<input type="checkbox" name="hide_for_admins" class="cp-checkbox" <?php checked( $cp_hide ); ?>>
				<span><?php esc_html_e( 'Hide the widget from logged-in administrators', 'chat-pilot' ); ?></span>
			</label>
		</div>

		<div class="cp-form-group">
			<label class="cp-label" for="cp-display-mode"><?php esc_html_e( 'Show the widget on', 'chat-pilot' ); ?></label>
			<select id="cp-display-mode" name="display_mode" class="cp-select">
				<option value="all" <?php selected( $cp_mode, 'all' ); ?>><?php esc_html_e( 'Every page', 'chat-pilot' ); ?></option>
				<option value="exclude" <?php selected( $cp_mode, 'exclude' ); ?>><?php esc_html_e( 'Every page except the ones listed below', 'chat-pilot' ); ?></option>
				<option value="include" <?php selected( $cp_mode, 'include' ); ?>><?php esc_html_e( 'Only the pages listed below', 'chat-pilot' ); ?></option>
			</select>
		</div>

		<div class="cp-form-group">
			<label class="cp-label" for="cp-display-rules"><?php esc_html_e( 'Pages', 'chat-pilot' ); ?></label>
			<input type="text" id="cp-display-rules" name="display_rules" class="cp-input" value="<?php echo esc_attr( $cp_rules ); ?>" placeholder="42, contact, pricing/plans">
			<p class="cp-help-text"><?php esc_html_e( 'Comma-separated post IDs or URL paths.', 'chat-pilot' ); ?></p>
		</div>

		<div class="cp-form-group">
			<label class="cp-checkbox-label">
				<input type="checkbox" name="enable_logging" class="cp-checkbox" <?php checked( $cp_logging ); ?>>
				<span><?php esc_html_e( 'Log connection events and API failures', 'chat-pilot' ); ?></span>
			</label>
			<p class="cp-help-text"><?php esc_html_e( 'Secrets are redacted before anything is written. Only the last 200 entries are kept.', 'chat-pilot' ); ?></p>
		</div>

		<div class="cp-form-group">
			<label class="cp-checkbox-label">
				<input type="checkbox" name="dev_mode" class="cp-checkbox" <?php checked( $cp_dev ); ?>>
				<span><?php esc_html_e( 'Developer mode (cache-busts plugin assets)', 'chat-pilot' ); ?></span>
			</label>
			<p class="cp-help-text"><?php esc_html_e( 'Affects asset versioning only. It never exposes diagnostics to visitors.', 'chat-pilot' ); ?></p>
		</div>

		<button type="button" id="cp-save-settings-btn" class="cp-btn cp-btn-primary">
			<?php esc_html_e( 'Save settings', 'chat-pilot' ); ?>
		</button>
	</form>
</div>

<div class="cp-card">
	<h3 class="cp-card-title">
		<?php esc_html_e( 'Plugin log', 'chat-pilot' ); ?>
		<button type="button" id="cp-clear-log-btn" class="cp-btn cp-btn-secondary cp-btn-sm"><?php esc_html_e( 'Clear log', 'chat-pilot' ); ?></button>
	</h3>

	<?php if ( empty( $cp_log ) ) : ?>
		<p class="cp-description"><?php esc_html_e( 'Nothing logged yet.', 'chat-pilot' ); ?></p>
	<?php else : ?>
		<div class="cp-table-wrap">
			<table class="cp-table">
				<thead>
					<tr>
						<th><?php esc_html_e( 'When', 'chat-pilot' ); ?></th>
						<th><?php esc_html_e( 'Level', 'chat-pilot' ); ?></th>
						<th><?php esc_html_e( 'Message', 'chat-pilot' ); ?></th>
					</tr>
				</thead>
				<tbody>
					<?php foreach ( $cp_log as $entry ) : ?>
						<tr>
							<td><?php echo esc_html( isset( $entry['time'] ) ? $entry['time'] : '' ); ?></td>
							<td><span class="cp-badge-log"><?php echo esc_html( isset( $entry['level'] ) ? $entry['level'] : '' ); ?></span></td>
							<td><?php echo esc_html( isset( $entry['message'] ) ? $entry['message'] : '' ); ?></td>
						</tr>
					<?php endforeach; ?>
				</tbody>
			</table>
		</div>
	<?php endif; ?>
</div>

<div class="cp-card">
	<h3 class="cp-card-title"><?php esc_html_e( 'Diagnostics', 'chat-pilot' ); ?></h3>
	<div class="cp-info-list">
		<div class="cp-info-row">
			<span class="cp-info-label"><?php esc_html_e( 'Plugin version', 'chat-pilot' ); ?></span>
			<span class="cp-info-value"><?php echo esc_html( CHAT_PILOT_VERSION ); ?></span>
		</div>
		<div class="cp-info-row">
			<span class="cp-info-label"><?php esc_html_e( 'API version', 'chat-pilot' ); ?></span>
			<span class="cp-info-value"><?php echo esc_html( CHAT_PILOT_API_VERSION ); ?></span>
		</div>
		<div class="cp-info-row">
			<span class="cp-info-label"><?php esc_html_e( 'Chat Pilot endpoint', 'chat-pilot' ); ?></span>
			<span class="cp-info-value"><?php echo esc_html( \ChatPilot\Api\Client::base_url() ); ?></span>
		</div>
		<div class="cp-info-row">
			<span class="cp-info-label"><?php esc_html_e( 'PHP version', 'chat-pilot' ); ?></span>
			<span class="cp-info-value"><?php echo esc_html( PHP_VERSION ); ?></span>
		</div>
		<div class="cp-info-row">
			<span class="cp-info-label"><?php esc_html_e( 'Ownership endpoint', 'chat-pilot' ); ?></span>
			<span class="cp-info-value"><code><?php echo esc_html( home_url( '/wp-json/chat-pilot/v1/site-token' ) ); ?></code></span>
		</div>
	</div>
</div>
