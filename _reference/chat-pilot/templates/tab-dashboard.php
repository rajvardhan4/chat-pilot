<?php
/**
 * Tab Dashboard Template
 */

// Prevent direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$plugin        = \ChatPilot\Core\Plugin::instance();
$dev_mode      = $plugin->settings->get( 'general.dev_mode', false );
$enable_plugin = $plugin->settings->get( 'general.enable_plugin', true );
$plugin_name   = $plugin->settings->get( 'general.plugin_name', 'Chat Pilot' );
$db_version    = $plugin->settings->get( 'system.db_version', '1.0.0' );

global $wp_version;
$php_version = PHP_VERSION;
$ssl_active  = is_ssl();

// Fetch live provider status list.
$providers_status = $plugin->providers->get_available_providers();
?>

<div class="cp-dashboard-grid">
	<!-- Left Main Content Area -->
	<div class="cp-grid-main">
		<!-- Welcome Card -->
		<div class="cp-card">
			<h2 class="cp-card-title">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
				<?php printf( esc_html__( 'Welcome to %s Dashboard', 'chat-pilot' ), esc_html( $plugin_name ) ); ?>
			</h2>
			<p class="overview-text">
				<?php esc_html_e( 'Welcome to the core management center. AI Provider Management is fully operational. Set credentials and test API connections.', 'chat-pilot' ); ?>
			</p>
			
			<div class="cp-alert <?php echo $enable_plugin ? 'cp-alert-success' : 'cp-alert-error'; ?>" style="margin-top: 1rem;">
				<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
				<div>
					<strong>
						<?php echo $enable_plugin ? esc_html__( 'Chat Pilot Engine Active', 'chat-pilot' ) : esc_html__( 'Chat Pilot Engine Offline', 'chat-pilot' ); ?>
					</strong>
					<span style="font-size: 0.85rem; display: block; margin-top: 0.25rem;">
						<?php echo $enable_plugin ? esc_html__( 'The core plugin systems are running normally. Safe integrations and security nonces are listening.', 'chat-pilot' ) : esc_html__( 'The plugin has been disabled in settings. Frontend widgets and API hooks will not load.', 'chat-pilot' ); ?>
					</span>
				</div>
			</div>
		</div>

		<!-- AI Provider Status (Live Cards) -->
		<div class="cp-card">
			<h2 class="cp-card-title">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>
				<?php esc_html_e( 'AI Provider Status Metrics', 'chat-pilot' ); ?>
			</h2>
			<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1.5rem;">
				<?php foreach ( $providers_status as $slug => $info ) : ?>
					<div style="background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255,255,255,0.05); border-radius: 8px; padding: 1.5rem; display: flex; flex-direction: column; gap: 0.75rem;">
						<div style="display:flex; justify-content:space-between; align-items:center;">
							<span style="font-weight: 700; color: var(--text-primary); font-family: 'Outfit', sans-serif;"><?php echo esc_html( $info['name'] ); ?></span>
							<span class="status-badge <?php echo esc_attr( str_replace( ' ', '-', $info['status'] ) ); ?>" style="font-size: 0.65rem; padding: 0.15rem 0.4rem;">
								<?php echo esc_html( $info['status'] ); ?>
							</span>
						</div>
						
						<ul class="cp-info-list" style="font-size:0.75rem; gap:0.25rem;">
							<li class="cp-info-row" style="padding:0;">
								<span class="cp-info-label"><?php esc_html_e( 'Default Model', 'chat-pilot' ); ?></span>
								<span class="cp-info-value" style="font-family: var(--font-mono); font-size: 0.7rem; max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
									<?php echo esc_html( ! empty( $info['default_model'] ) ? $info['default_model'] : '—' ); ?>
								</span>
							</li>
							<li class="cp-info-row" style="padding:0;">
								<span class="cp-info-label"><?php esc_html_e( 'Response Time', 'chat-pilot' ); ?></span>
								<span class="cp-info-value"><?php echo esc_html( $info['response_time'] ); ?> ms</span>
							</li>
							<li class="cp-info-row" style="padding:0;">
								<span class="cp-info-label"><?php esc_html_e( 'Active Toggle', 'chat-pilot' ); ?></span>
								<span class="cp-info-value" style="color: <?php echo $info['enabled'] ? 'var(--accent-green)' : 'var(--text-muted)'; ?>;">
									<?php echo $info['enabled'] ? esc_html__( 'Enabled', 'chat-pilot' ) : esc_html__( 'Disabled', 'chat-pilot' ); ?>
								</span>
							</li>
						</ul>
					</div>
				<?php endforeach; ?>
			</div>
		</div>

		<!-- Recent Activity Log (Placeholder) -->
		<div class="cp-card">
			<h2 class="cp-card-title">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>
				<?php esc_html_e( 'Recent Activity', 'chat-pilot' ); ?>
			</h2>
			<div style="border-left: 2px solid rgba(255,255,255,0.05); padding-left: 1.5rem; margin-left: 0.5rem; display: flex; flex-direction: column; gap: 1.5rem;">
				<div>
					<span style="font-size: 0.75rem; color: var(--text-muted);">July 22, 2026</span>
					<p style="font-size: 0.9rem; color: var(--text-secondary); margin-top: 0.25rem;">
						<?php esc_html_e( 'AI Provider Management features loaded. OpenAI and Google Gemini connection hooks verified.', 'chat-pilot' ); ?>
					</p>
				</div>
				<div>
					<span style="font-size: 0.75rem; color: var(--text-muted);">July 18, 2026</span>
					<p style="font-size: 0.9rem; color: var(--text-secondary); margin-top: 0.25rem;">
						<?php esc_html_e( 'Plugin core system bootstrapping completed successfully.', 'chat-pilot' ); ?>
					</p>
				</div>
			</div>
		</div>
	</div>

	<!-- Right Sidebar Area -->
	<div class="cp-grid-sidebar">
		<!-- System Information -->
		<div class="cp-card">
			<h2 class="cp-card-title">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
				<?php esc_html_e( 'System Information', 'chat-pilot' ); ?>
			</h2>
			<ul class="cp-info-list">
				<li class="cp-info-row">
					<span class="cp-info-label"><?php esc_html_e( 'Plugin Version', 'chat-pilot' ); ?></span>
					<span class="cp-info-value">v<?php echo esc_html( CHAT_PILOT_VERSION ); ?></span>
				</li>
				<li class="cp-info-row">
					<span class="cp-info-label"><?php esc_html_e( 'WordPress Version', 'chat-pilot' ); ?></span>
					<span class="cp-info-value">v<?php echo esc_html( $wp_version ); ?></span>
				</li>
				<li class="cp-info-row">
					<span class="cp-info-label"><?php esc_html_e( 'PHP Version', 'chat-pilot' ); ?></span>
					<span class="cp-info-value"><?php echo esc_html( $php_version ); ?></span>
				</li>
				<li class="cp-info-row">
					<span class="cp-info-label"><?php esc_html_e( 'SSL Encryption', 'chat-pilot' ); ?></span>
					<span class="cp-info-value" style="color: <?php echo $ssl_active ? 'var(--accent-green)' : 'var(--accent-orange)'; ?>;">
						<?php echo $ssl_active ? esc_html__( 'Secure (SSL)', 'chat-pilot' ) : esc_html__( 'Unsecure', 'chat-pilot' ); ?>
					</span>
				</li>
				<li class="cp-info-row">
					<span class="cp-info-label"><?php esc_html_e( 'Database Schema', 'chat-pilot' ); ?></span>
					<span class="cp-info-value">v<?php echo esc_html( $db_version ); ?></span>
				</li>
			</ul>
		</div>

		<!-- Quick Actions -->
		<div class="cp-card">
			<h2 class="cp-card-title">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path><line x1="12" y1="2" x2="12" y2="12"></line></svg>
				<?php esc_html_e( 'Quick Operations', 'chat-pilot' ); ?>
			</h2>
			<div style="display:flex; flex-direction:column; gap:0.75rem;">
				<a href="<?php echo esc_url( add_query_arg( 'tab', 'providers' ) ); ?>" class="cp-btn cp-btn-primary" style="justify-content:center; text-decoration:none;">
					<?php esc_html_e( 'Configure AI Providers', 'chat-pilot' ); ?>
				</a>
				<a href="<?php echo esc_url( add_query_arg( 'tab', 'playground' ) ); ?>" class="cp-btn cp-btn-secondary" style="justify-content:center; text-decoration:none;">
					<?php esc_html_e( 'Completions Playground', 'chat-pilot' ); ?>
				</a>
			</div>
		</div>
	</div>
</div>
