<?php
/**
 * Chat Widget tab.
 *
 * Appearance and behaviour are configured in Chat Pilot Cloud so a single
 * dashboard drives every site. This screen shows exactly what this WordPress
 * install has cached, which is what visitors are seeing right now, plus the
 * WordPress-only controls that genuinely belong here: whether the widget is
 * allowed to render at all, and on which pages.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$cp_plugin = \ChatPilot\Core\Plugin::instance();
$cp_config = \ChatPilot\Api\ConfigCache::get();
$cp_widget = isset( $cp_config['widget'] ) ? $cp_config['widget'] : array();

$cp_enable_plugin   = (bool) $cp_plugin->settings->get( 'general.enable_plugin', true );
$cp_hide_for_admins = (bool) $cp_plugin->settings->get( 'display.hide_for_admins', false );
$cp_mode            = (string) $cp_plugin->settings->get( 'display.mode', 'all' );
$cp_rules           = (string) $cp_plugin->settings->get( 'display.rules', '' );
?>

<?php require CHAT_PILOT_PATH . 'templates/partial-not-connected.php'; ?>

<div class="cp-card">
	<h2 class="cp-card-title">
		<?php esc_html_e( 'Chat Widget', 'chat-pilot' ); ?>
		<span class="cp-badge-log <?php echo ! empty( $cp_widget['enabled'] ) ? 'cp-badge-success' : ''; ?>">
			<?php echo esc_html( ! empty( $cp_widget['enabled'] ) ? __( 'Enabled in Chat Pilot', 'chat-pilot' ) : __( 'Disabled in Chat Pilot', 'chat-pilot' ) ); ?>
		</span>
	</h2>
	<p class="cp-description">
		<?php esc_html_e( 'These values come from Chat Pilot Cloud and are cached on this site. They are what your visitors see right now.', 'chat-pilot' ); ?>
	</p>

	<?php if ( empty( $cp_widget ) ) : ?>
		<div class="cp-alert cp-alert-warning">
			<?php esc_html_e( 'No widget configuration is cached yet. Check the Connection tab, then press Sync.', 'chat-pilot' ); ?>
		</div>
	<?php else : ?>
		<div class="cp-info-list">
			<div class="cp-info-row">
				<span class="cp-info-label"><?php esc_html_e( 'Header title', 'chat-pilot' ); ?></span>
				<span class="cp-info-value"><?php echo esc_html( isset( $cp_widget['displayName'] ) ? $cp_widget['displayName'] : '' ); ?></span>
			</div>
			<div class="cp-info-row">
				<span class="cp-info-label"><?php esc_html_e( 'Primary colour', 'chat-pilot' ); ?></span>
				<span class="cp-info-value">
					<span style="display:inline-block; width:14px; height:14px; border-radius:3px; vertical-align:middle; margin-right:6px; background:<?php echo esc_attr( isset( $cp_widget['primaryColor'] ) ? $cp_widget['primaryColor'] : '#06b6d4' ); ?>;"></span>
					<?php echo esc_html( isset( $cp_widget['primaryColor'] ) ? $cp_widget['primaryColor'] : '' ); ?>
				</span>
			</div>
			<div class="cp-info-row">
				<span class="cp-info-label"><?php esc_html_e( 'Position', 'chat-pilot' ); ?></span>
				<span class="cp-info-value"><?php echo esc_html( isset( $cp_widget['position'] ) ? $cp_widget['position'] : '' ); ?></span>
			</div>
			<div class="cp-info-row">
				<span class="cp-info-label"><?php esc_html_e( 'Welcome message', 'chat-pilot' ); ?></span>
				<span class="cp-info-value"><?php echo esc_html( isset( $cp_widget['welcomeMessage'] ) ? $cp_widget['welcomeMessage'] : '' ); ?></span>
			</div>
			<div class="cp-info-row">
				<span class="cp-info-label"><?php esc_html_e( 'Suggested questions', 'chat-pilot' ); ?></span>
				<span class="cp-info-value"><?php echo esc_html( ! empty( $cp_widget['suggestedQuestions'] ) ? implode( ' | ', (array) $cp_widget['suggestedQuestions'] ) : '—' ); ?></span>
			</div>
			<div class="cp-info-row">
				<span class="cp-info-label"><?php esc_html_e( 'Typing indicator', 'chat-pilot' ); ?></span>
				<span class="cp-info-value"><?php echo esc_html( ! empty( $cp_widget['enableTyping'] ) ? __( 'On', 'chat-pilot' ) : __( 'Off', 'chat-pilot' ) ); ?></span>
			</div>
			<div class="cp-info-row">
				<span class="cp-info-label"><?php esc_html_e( 'Character streaming', 'chat-pilot' ); ?></span>
				<span class="cp-info-value"><?php echo esc_html( ! empty( $cp_widget['enableStreaming'] ) ? __( 'On', 'chat-pilot' ) : __( 'Off', 'chat-pilot' ) ); ?></span>
			</div>
			<div class="cp-info-row">
				<span class="cp-info-label"><?php esc_html_e( 'Auto open', 'chat-pilot' ); ?></span>
				<span class="cp-info-value">
					<?php
					echo esc_html(
						! empty( $cp_widget['autoOpenChat'] )
							/* translators: %d: delay in seconds */
							? sprintf( __( 'After %d seconds', 'chat-pilot' ), isset( $cp_widget['autoOpenDelay'] ) ? (int) $cp_widget['autoOpenDelay'] : 5 )
							: __( 'Off', 'chat-pilot' )
					);
					?>
				</span>
			</div>
			<div class="cp-info-row">
				<span class="cp-info-label"><?php esc_html_e( 'Pre-chat form', 'chat-pilot' ); ?></span>
				<span class="cp-info-value"><?php echo esc_html( ! empty( $cp_widget['prechat']['enabled'] ) ? __( 'Shown before chat', 'chat-pilot' ) : __( 'Not shown', 'chat-pilot' ) ); ?></span>
			</div>
		</div>
	<?php endif; ?>

	<div class="cp-actions-row" style="margin-top:1.5rem;">
		<a class="cp-btn cp-btn-primary" href="<?php echo esc_url( \ChatPilot\Api\Connection::dashboard_url( 'widget' ) ); ?>" target="_blank" rel="noopener noreferrer">
			<?php esc_html_e( 'Customise widget in Chat Pilot', 'chat-pilot' ); ?>
		</a>
		<button type="button" id="cp-sync-config-btn" class="cp-btn cp-btn-secondary">
			<?php esc_html_e( 'Sync now', 'chat-pilot' ); ?>
		</button>
	</div>
</div>

<div class="cp-card">
	<h3 class="cp-card-title"><?php esc_html_e( 'WordPress display rules', 'chat-pilot' ); ?></h3>
	<p class="cp-description">
		<?php esc_html_e( 'These controls are specific to this WordPress install and stay here. They decide whether this site renders the widget at all, and where.', 'chat-pilot' ); ?>
	</p>

	<form id="cp-settings-form" class="cp-form">
		<div class="cp-form-group">
			<label class="cp-checkbox-label">
				<input type="checkbox" name="enable_plugin" class="cp-checkbox" <?php checked( $cp_enable_plugin ); ?>>
				<span><?php esc_html_e( 'Render the Chat Pilot widget on this website', 'chat-pilot' ); ?></span>
			</label>
			<p class="cp-help-text"><?php esc_html_e( 'A master switch for this site. Turning it off does not change anything in Chat Pilot Cloud.', 'chat-pilot' ); ?></p>
		</div>

		<div class="cp-form-group">
			<label class="cp-checkbox-label">
				<input type="checkbox" name="hide_for_admins" class="cp-checkbox" <?php checked( $cp_hide_for_admins ); ?>>
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
			<p class="cp-help-text"><?php esc_html_e( 'Comma-separated post IDs or URL paths. Ignored when showing on every page.', 'chat-pilot' ); ?></p>
		</div>

		<button type="button" id="cp-save-settings-btn" class="cp-btn cp-btn-primary">
			<?php esc_html_e( 'Save display rules', 'chat-pilot' ); ?>
		</button>
	</form>
</div>
