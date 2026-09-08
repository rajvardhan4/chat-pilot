<?php
/**
 * Tab Security Status Template
 */

// Prevent direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$ssl_active = is_ssl();
$wp_debug = defined( 'WP_DEBUG' ) && WP_DEBUG;
$user_can = current_user_can( 'manage_options' );
$php_safe = version_compare( PHP_VERSION, '8.0', '>=' );
?>

<div class="cp-dashboard-grid">
	<!-- Main Security Audit Panel -->
	<div class="cp-grid-main">
		<div class="cp-card">
			<h2 class="cp-card-title">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
				<?php esc_html_e( 'Security Audit & Compliance', 'chat-pilot' ); ?>
			</h2>

			<p class="overview-text">
				<?php esc_html_e( 'Review the local WordPress security configuration audit checklist to verify environment compliance.', 'chat-pilot' ); ?>
			</p>

			<ul class="cp-info-list" style="margin-top: 1.5rem;">
				<!-- HTTPS Status -->
				<li class="cp-info-row">
					<span class="cp-info-label">
						<strong><?php esc_html_e( 'SSL Connection (HTTPS)', 'chat-pilot' ); ?></strong>
						<p class="cp-description"><?php esc_html_e( 'Encrypts communication logs between administrative browsers and servers.', 'chat-pilot' ); ?></p>
					</span>
					<span class="cp-info-value" style="display:flex; align-items:center; gap:0.5rem; color: <?php echo $ssl_active ? 'var(--accent-green)' : 'var(--accent-red)'; ?>;">
						<?php if ( $ssl_active ) : ?>
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg>
							<?php esc_html_e( 'Secure (SSL Active)', 'chat-pilot' ); ?>
						<?php else : ?>
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
							<?php esc_html_e( 'Unsecure (No SSL Detected)', 'chat-pilot' ); ?>
						<?php endif; ?>
					</span>
				</li>

				<!-- WordPress Debug Mode -->
				<li class="cp-info-row">
					<span class="cp-info-label">
						<strong><?php esc_html_e( 'WordPress Debug Mode (WP_DEBUG)', 'chat-pilot' ); ?></strong>
						<p class="cp-description"><?php esc_html_e( 'Production systems should hide internal PHP notices to prevent information leakage.', 'chat-pilot' ); ?></p>
					</span>
					<span class="cp-info-value" style="display:flex; align-items:center; gap:0.5rem; color: <?php echo $wp_debug ? 'var(--accent-purple)' : 'var(--accent-green)'; ?>;">
						<?php if ( $wp_debug ) : ?>
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path></svg>
							<?php esc_html_e( 'Notice (WP_DEBUG Enabled)', 'chat-pilot' ); ?>
						<?php else : ?>
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg>
							<?php esc_html_e( 'Secure (Debug Hidden)', 'chat-pilot' ); ?>
						<?php endif; ?>
					</span>
				</li>

				<!-- Capabilities Enforcement -->
				<li class="cp-info-row">
					<span class="cp-info-label">
						<strong><?php esc_html_e( 'Dashboard Access Gatekeeper', 'chat-pilot' ); ?></strong>
						<p class="cp-description"><?php esc_html_e( 'Requires strict Administrator level capabilities (manage_options) to edit configurations.', 'chat-pilot' ); ?></p>
					</span>
					<span class="cp-info-value" style="display:flex; align-items:center; gap:0.5rem; color: <?php echo $user_can ? 'var(--accent-green)' : 'var(--accent-red)'; ?>;">
						<?php if ( $user_can ) : ?>
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg>
							<?php esc_html_e( 'Authorized (manage_options Verified)', 'chat-pilot' ); ?>
						<?php else : ?>
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
							<?php esc_html_e( 'Access Forbidden', 'chat-pilot' ); ?>
						<?php endif; ?>
					</span>
				</li>

				<!-- PHP Version Safe check -->
				<li class="cp-info-row">
					<span class="cp-info-label">
						<strong><?php esc_html_e( 'PHP Engine Security Status', 'chat-pilot' ); ?></strong>
						<p class="cp-description"><?php esc_html_e( 'Requires modern PHP versions supporting memory optimization and structural protection.', 'chat-pilot' ); ?></p>
					</span>
					<span class="cp-info-value" style="display:flex; align-items:center; gap:0.5rem; color: <?php echo $php_safe ? 'var(--accent-green)' : 'var(--accent-purple)'; ?>;">
						<?php if ( $php_safe ) : ?>
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg>
							<?php esc_html_e( 'Safe Engine Version', 'chat-pilot' ); ?> (PHP <?php echo esc_html( PHP_VERSION ); ?>)
						<?php else : ?>
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path></svg>
							<?php esc_html_e( 'Outdated Engine', 'chat-pilot' ); ?> (PHP <?php echo esc_html( PHP_VERSION ); ?>)
						<?php endif; ?>
					</span>
				</li>
			</ul>
		</div>
	</div>

	<!-- Sidebar Security Guard Info -->
	<div class="cp-grid-sidebar">
		<div class="cp-card">
			<h2 class="cp-card-title">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
				<?php esc_html_e( 'Anti-CSRF Guard', 'chat-pilot' ); ?>
			</h2>
			<p style="font-size:0.9rem; color:var(--text-secondary); line-height:1.6; margin-bottom:1.25rem;">
				<?php esc_html_e( 'Nonces are dynamic, user-session based cryptographic keys that protect WordPress admin forms from cross-site request forgery attacks.', 'chat-pilot' ); ?>
			</p>
			<p style="font-size:0.9rem; color:var(--text-secondary); line-height:1.6;">
				<?php esc_html_e( 'All data operations in Chat Pilot require verification of a unique admin nonce before execution.', 'chat-pilot' ); ?>
			</p>
		</div>
	</div>
</div>
