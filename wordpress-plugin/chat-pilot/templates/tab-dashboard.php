<?php
/**
 * Dashboard tab.
 *
 * A live status board for this website, built from one signed /site/health call
 * plus the cached widget config. It answers the question an administrator
 * actually has on this screen: is the chatbot working right now, and if not,
 * which piece is missing?
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$cp_state  = \ChatPilot\Api\Connection::get_state();
$cp_health = \ChatPilot\Api\Connection::health();
$cp_ok     = ! empty( $cp_health['success'] );
$cp_data   = $cp_ok ? $cp_health['health'] : array();
$cp_config = \ChatPilot\Api\ConfigCache::get();
$cp_widget = isset( $cp_config['widget'] ) ? $cp_config['widget'] : array();
?>

<?php require CHAT_PILOT_PATH . 'templates/partial-not-connected.php'; ?>

<?php
// A health failure on a site that IS connected still needs saying - the panel
// above only covers "no key at all". Saying both at once just repeats itself.
if ( ! $cp_ok && \ChatPilot\Api\Connection::is_connected() ) :
	?>
	<div class="cp-alert cp-alert-error">
		<?php echo esc_html( $cp_health['message'] ); ?>
		<a href="<?php echo esc_url( admin_url( 'admin.php?page=chat-pilot&tab=connection' ) ); ?>">
			<?php esc_html_e( 'Open connection settings', 'chat-pilot' ); ?>
		</a>
	</div>
	<?php
endif;
?>

<div class="cp-card">
	<h2 class="cp-card-title">
		<?php echo esc_html( isset( $cp_state['website_name'] ) && $cp_state['website_name'] ? $cp_state['website_name'] : __( 'This website', 'chat-pilot' ) ); ?>
		<small><?php echo esc_html( isset( $cp_state['domain'] ) ? $cp_state['domain'] : '' ); ?></small>
	</h2>

	<div class="cp-dashboard-grid">
		<div class="cp-kpi-card">
			<div class="kpi-icon">&#128225;</div>
			<div>
				<div class="kpi-value"><?php echo esc_html( $cp_ok ? __( 'Connected', 'chat-pilot' ) : __( 'Offline', 'chat-pilot' ) ); ?></div>
				<div class="kpi-label"><?php esc_html_e( 'Chat Pilot Cloud', 'chat-pilot' ); ?></div>
			</div>
		</div>

		<div class="cp-kpi-card">
			<div class="kpi-icon">&#129302;</div>
			<div>
				<div class="kpi-value">
					<?php echo esc_html( ! empty( $cp_data['provider_configured'] ) ? __( 'Ready', 'chat-pilot' ) : __( 'Not set', 'chat-pilot' ) ); ?>
				</div>
				<div class="kpi-label"><?php esc_html_e( 'AI Provider', 'chat-pilot' ); ?></div>
			</div>
		</div>

		<div class="cp-kpi-card">
			<div class="kpi-icon">&#128218;</div>
			<div>
				<div class="kpi-value"><?php echo esc_html( isset( $cp_data['knowledge_documents'] ) ? (int) $cp_data['knowledge_documents'] : 0 ); ?></div>
				<div class="kpi-label"><?php esc_html_e( 'Knowledge Documents', 'chat-pilot' ); ?></div>
			</div>
		</div>

		<div class="cp-kpi-card">
			<div class="kpi-icon">&#128172;</div>
			<div>
				<div class="kpi-value">
					<?php echo esc_html( ! empty( $cp_data['widget_enabled'] ) ? __( 'On', 'chat-pilot' ) : __( 'Off', 'chat-pilot' ) ); ?>
				</div>
				<div class="kpi-label"><?php esc_html_e( 'Chat Widget', 'chat-pilot' ); ?></div>
			</div>
		</div>
	</div>
</div>

<?php if ( $cp_ok && empty( $cp_data['provider_configured'] ) ) : ?>
	<div class="cp-alert cp-alert-warning">
		<?php esc_html_e( 'No AI provider is configured for this website yet, so the chatbot cannot generate answers.', 'chat-pilot' ); ?>
		<a href="<?php echo esc_url( \ChatPilot\Api\Connection::dashboard_url( 'providers' ) ); ?>" target="_blank" rel="noopener noreferrer">
			<?php esc_html_e( 'Configure it in Chat Pilot', 'chat-pilot' ); ?>
		</a>
	</div>
<?php endif; ?>

<?php if ( $cp_ok && empty( $cp_data['knowledge_documents'] ) ) : ?>
	<div class="cp-alert cp-alert-warning">
		<?php esc_html_e( 'The Knowledge Base is empty, so every business question will return your fallback message.', 'chat-pilot' ); ?>
		<a href="<?php echo esc_url( \ChatPilot\Api\Connection::dashboard_url( 'knowledge' ) ); ?>" target="_blank" rel="noopener noreferrer">
			<?php esc_html_e( 'Add knowledge in Chat Pilot', 'chat-pilot' ); ?>
		</a>
	</div>
<?php endif; ?>

<div class="cp-grid" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(320px, 1fr)); gap:1.5rem;">
	<div class="cp-card">
		<h3 class="cp-card-title"><?php esc_html_e( 'Widget on this site', 'chat-pilot' ); ?></h3>
		<div class="cp-info-list">
			<div class="cp-info-row">
				<span class="cp-info-label"><?php esc_html_e( 'Header title', 'chat-pilot' ); ?></span>
				<span class="cp-info-value"><?php echo esc_html( isset( $cp_widget['displayName'] ) ? $cp_widget['displayName'] : '—' ); ?></span>
			</div>
			<div class="cp-info-row">
				<span class="cp-info-label"><?php esc_html_e( 'Position', 'chat-pilot' ); ?></span>
				<span class="cp-info-value"><?php echo esc_html( isset( $cp_widget['position'] ) ? $cp_widget['position'] : '—' ); ?></span>
			</div>
			<div class="cp-info-row">
				<span class="cp-info-label"><?php esc_html_e( 'Pre-chat form', 'chat-pilot' ); ?></span>
				<span class="cp-info-value">
					<?php echo esc_html( ! empty( $cp_widget['prechat']['enabled'] ) ? __( 'Enabled', 'chat-pilot' ) : __( 'Disabled', 'chat-pilot' ) ); ?>
				</span>
			</div>
			<div class="cp-info-row">
				<span class="cp-info-label"><?php esc_html_e( 'Auto open', 'chat-pilot' ); ?></span>
				<span class="cp-info-value">
					<?php echo esc_html( ! empty( $cp_widget['autoOpenChat'] ) ? __( 'Yes', 'chat-pilot' ) : __( 'No', 'chat-pilot' ) ); ?>
				</span>
			</div>
		</div>
		<div class="cp-actions-row" style="margin-top:1.25rem;">
			<a class="cp-btn cp-btn-secondary" href="<?php echo esc_url( \ChatPilot\Api\Connection::dashboard_url( 'widget' ) ); ?>" target="_blank" rel="noopener noreferrer">
				<?php esc_html_e( 'Customise widget', 'chat-pilot' ); ?>
			</a>
			<button type="button" id="cp-sync-config-btn" class="cp-btn cp-btn-secondary">
				<?php esc_html_e( 'Sync now', 'chat-pilot' ); ?>
			</button>
		</div>
	</div>

	<div class="cp-card">
		<h3 class="cp-card-title"><?php esc_html_e( 'Manage in Chat Pilot Cloud', 'chat-pilot' ); ?></h3>
		<p class="cp-description">
			<?php esc_html_e( 'Your AI provider, knowledge, instructions, widget design, forms, conversations and analytics are all managed in Chat Pilot Cloud, so one dashboard covers every website you run.', 'chat-pilot' ); ?>
		</p>
		<div class="cp-cloud-links">
			<?php foreach ( $controller->cloud_destinations() as $cp_section => $cp_label ) : ?>
				<a class="cp-btn cp-btn-secondary"
				   href="<?php echo esc_url( \ChatPilot\Api\Connection::dashboard_url( $cp_section ) ); ?>"
				   target="_blank" rel="noopener noreferrer">
					<?php echo esc_html( $cp_label ); ?>
				</a>
			<?php endforeach; ?>
		</div>
	</div>

	<div class="cp-card">
		<h3 class="cp-card-title"><?php esc_html_e( 'Support', 'chat-pilot' ); ?></h3>
		<p class="cp-description">
			<?php esc_html_e( 'Chat Pilot is built and supported by Local Marketing Geeks.', 'chat-pilot' ); ?>
		</p>
		<div class="cp-info-list">
			<div class="cp-info-row">
				<span class="cp-info-label"><?php esc_html_e( 'Phone', 'chat-pilot' ); ?></span>
				<span class="cp-info-value">888-299-2726</span>
			</div>
			<div class="cp-info-row">
				<span class="cp-info-label"><?php esc_html_e( 'Email', 'chat-pilot' ); ?></span>
				<span class="cp-info-value">info@localmarketinggeeks.com</span>
			</div>
			<div class="cp-info-row">
				<span class="cp-info-label"><?php esc_html_e( 'Plugin version', 'chat-pilot' ); ?></span>
				<span class="cp-info-value"><?php echo esc_html( CHAT_PILOT_VERSION ); ?></span>
			</div>
		</div>
	</div>
</div>
