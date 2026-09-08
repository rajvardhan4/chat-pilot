<?php
/**
 * Tab Database Logs Template
 */

// Prevent direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

global $wpdb;
$table_name = $wpdb->prefix . 'chat_pilot_logs';

$logs     = array();
$db_exist = ( $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $table_name ) ) === $table_name );

if ( $db_exist ) {
	$logs = $wpdb->get_results( "SELECT * FROM {$table_name} ORDER BY id DESC LIMIT 50" ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
}

$plugin   = \ChatPilot\Core\Plugin::instance();
$dev_mode = $plugin->settings->get( 'general.dev_mode', false );
?>

<div class="cp-dashboard-grid">
	<!-- Logs Main List Card -->
	<div class="cp-grid-main">
		<div class="cp-card">
			<h2 class="cp-card-title">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>
				<?php esc_html_e( 'System Logging Records', 'chat-pilot' ); ?>
			</h2>

			<?php if ( ! $dev_mode ) : ?>
				<div class="cp-alert cp-alert-success" style="margin-bottom:1.5rem;">
					<?php esc_html_e( 'Notice: System is running in production mode. Standard event logs are bypassed, only system exceptions (Errors) will be stored.', 'chat-pilot' ); ?>
				</div>
			<?php endif; ?>

			<div class="cp-table-wrap">
				<table class="cp-table">
					<thead>
						<tr>
							<th style="width: 15%;"><?php esc_html_e( 'Timestamp', 'chat-pilot' ); ?></th>
							<th style="width: 12%;"><?php esc_html_e( 'Log Level', 'chat-pilot' ); ?></th>
							<th style="width: 50%;"><?php esc_html_e( 'Log Message', 'chat-pilot' ); ?></th>
							<th style="width: 23%;"><?php esc_html_e( 'Context Details', 'chat-pilot' ); ?></th>
						</tr>
					</thead>
					<tbody>
						<?php if ( empty( $logs ) ) : ?>
							<tr>
								<td colspan="4" style="text-align: center; color: var(--text-muted); padding: 2rem;">
									<?php esc_html_e( 'No log entries found in the database.', 'chat-pilot' ); ?>
								</td>
							</tr>
						<?php else : ?>
							<?php foreach ( $logs as $log ) : ?>
								<?php
								$badge_class = 'info';
								if ( 'error' === $log->level ) {
									$badge_class = 'error';
								} elseif ( 'debug' === $log->level ) {
									$badge_class = 'debug';
								}
								?>
								<tr>
									<td><?php echo esc_html( $log->timestamp ); ?></td>
									<td>
										<span class="cp-badge-log <?php echo esc_attr( $badge_class ); ?>">
											<?php echo esc_html( $log->level ); ?>
										</span>
									</td>
									<td style="color: var(--text-primary); font-weight: 500;">
										<?php echo esc_html( $log->message ); ?>
									</td>
									<td style="font-family: monospace; font-size: 0.75rem; color: var(--text-muted);">
										<?php echo $log->context ? esc_html( $log->context ) : '-'; ?>
									</td>
								</tr>
							<?php endforeach; ?>
						<?php endif; ?>
					</tbody>
				</table>
			</div>
		</div>
	</div>

	<!-- Sidebar Database Info Card -->
	<div class="cp-grid-sidebar">
		<div class="cp-card">
			<h2 class="cp-card-title">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path><path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"></path></svg>
				<?php esc_html_e( 'Database Metrics', 'chat-pilot' ); ?>
			</h2>

			<ul class="cp-info-list">
				<li class="cp-info-row">
					<span class="cp-info-label"><?php esc_html_e( 'Logs Table Active', 'chat-pilot' ); ?></span>
					<span class="cp-info-value" style="color: <?php echo $db_exist ? 'var(--accent-green)' : 'var(--accent-red)'; ?>;">
						<?php echo $db_exist ? esc_html__( 'Active', 'chat-pilot' ) : esc_html__( 'Missing', 'chat-pilot' ); ?>
					</span>
				</li>
				<li class="cp-info-row">
					<span class="cp-info-label"><?php esc_html_e( 'Total Log Count', 'chat-pilot' ); ?></span>
					<span class="cp-info-value">
						<?php
						if ( $db_exist ) {
							$count = $wpdb->get_var( "SELECT COUNT(*) FROM {$table_name}" ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
							echo esc_html( $count );
						} else {
							echo '0';
						}
						?>
					</span>
				</li>
				<li class="cp-info-row">
					<span class="cp-info-label"><?php esc_html_e( 'Database Version', 'chat-pilot' ); ?></span>
					<span class="cp-info-value">
						<?php echo esc_html( $plugin->settings->get( 'system.db_version', '0.0.0' ) ); ?>
					</span>
				</li>
			</ul>
			
			<?php if ( $dev_mode && $db_exist ) : ?>
				<button type="button" class="cp-btn cp-btn-secondary cp-js-dev-action" data-action-type="clear_logs" data-confirm="<?php esc_attr_e( 'Wipe all log entries?', 'chat-pilot' ); ?>" style="margin-top: 1.5rem; width: 100%; justify-content: center;">
					<?php esc_html_e( 'Wipe Log Records', 'chat-pilot' ); ?>
				</button>
			<?php endif; ?>
		</div>
	</div>
</div>
