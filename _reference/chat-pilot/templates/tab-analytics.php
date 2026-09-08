<?php
/**
 * Tab Analytics Template
 * Central executive dashboard for reporting, usage, tokens, AI costs, visitor telemetry, and KB performance.
 */

// Prevent direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$plugin         = \ChatPilot\Core\Plugin::instance();
$analytics_mgr = new \ChatPilot\Analytics\AnalyticsManager();
$form_mgr      = new \ChatPilot\Forms\FormManager();

$all_forms     = $form_mgr->get_forms();
$providers     = $plugin->providers->get_available_providers();

$initial_data  = $analytics_mgr->get_analytics_data( array( 'date_range' => '30days' ) );
$budget_info   = $initial_data['budget'];
$overview      = $initial_data['overview'];
?>
<div class="cp-analytics-wrap" style="display:flex; flex-direction:column; gap:1.5rem;">

	<!-- Top Title & Export Header -->
	<div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:1rem; background:rgba(30,41,59,0.7); padding:1.25rem 1.5rem; border-radius:12px; border:1px solid rgba(255,255,255,0.08);">
		<div>
			<h2 style="font-family:'Outfit', sans-serif; font-size:1.5rem; font-weight:800; color:#ffffff; margin:0 0 0.25rem 0; display:flex; align-items:center; gap:0.6rem;">
				<span>📊</span> <?php esc_html_e( 'Analytics & Telemetry Dashboard', 'chat-pilot' ); ?>
			</h2>
			<p style="font-size:0.85rem; color:var(--text-secondary); margin:0;">
				<?php esc_html_e( 'Comprehensive real-time reporting on chatbot usage, AI costs, token metrics, visitor behavior, and Knowledge Base performance.', 'chat-pilot' ); ?>
			</p>
		</div>
		<div style="display:flex; gap:0.75rem; align-items:center;">
			<a id="cp-analytics-export-csv" href="<?php echo esc_url( admin_url( 'admin-ajax.php?action=chat_pilot_export_analytics_csv&date_range=30days' ) ); ?>" class="cp-btn cp-btn-secondary" style="font-size:0.85rem; padding:0.5rem 1rem;">
				📥 <?php esc_html_e( 'Export CSV Report', 'chat-pilot' ); ?>
			</a>
		</div>
	</div>

	<!-- Budget Alert Banner (Dynamic) -->
	<div id="cp-budget-alert-banner" style="<?php echo ( 'none' !== $budget_info['warning_status'] ) ? '' : 'display:none;'; ?> background:rgba(239,68,68,0.12); border:1px solid rgba(239,68,68,0.3); border-radius:12px; padding:1rem 1.25rem; color:#fca5a5; font-size:0.9rem; font-weight:600; display:flex; align-items:center; justify-content:space-between; gap:1rem;">
		<div style="display:flex; align-items:center; gap:0.75rem;">
			<span style="font-size:1.4rem;">⚠️</span>
			<span id="cp-budget-alert-text"><?php echo esc_html( $budget_info['warning_label'] ); ?></span>
		</div>
		<button type="button" class="cp-btn cp-btn-sm cp-btn-secondary" style="font-size:0.75rem;" onclick="jQuery('#cp-budget-card-anchor')[0].scrollIntoView({behavior:'smooth'});">
			<?php esc_html_e( 'Manage Budget', 'chat-pilot' ); ?>
		</button>
	</div>

	<!-- Provider Quota / Operational Warning Banner (Dynamic) -->
	<?php
	$provider_alert = isset( $initial_data['provider_alert'] ) ? $initial_data['provider_alert'] : null;
	$has_provider_alert = ! empty( $provider_alert );
	?>
	<div id="cp-provider-alert-banner" style="<?php echo $has_provider_alert ? '' : 'display:none;'; ?> background:rgba(220,38,38,0.15); border:1px solid rgba(220,38,38,0.4); border-radius:12px; padding:1rem 1.25rem; color:#fca5a5; font-size:0.9rem; font-weight:600; display:flex; align-items:center; justify-content:space-between; gap:1rem; margin-top:0.75rem;">
		<div style="display:flex; align-items:center; gap:0.75rem;">
			<span style="font-size:1.4rem;">🚨</span>
			<div>
				<div style="font-weight:700; color:#ef4444; font-size:0.92rem; display:flex; align-items:center; gap:0.5rem;">
					<span><?php esc_html_e( 'AI Provider Warning:', 'chat-pilot' ); ?></span>
					<span id="cp-provider-alert-title"><?php echo esc_html( $has_provider_alert ? sprintf( esc_html__( '%s requests are currently being rejected (%s)', 'chat-pilot' ), $provider_alert['provider'], $provider_alert['label'] ) : '' ); ?></span>
				</div>
				<div id="cp-provider-alert-desc" style="font-size:0.78rem; font-weight:400; color:#fca5a5; margin-top:2px;">
					<?php echo esc_html( $has_provider_alert ? ( ! empty( $provider_alert['message'] ) ? $provider_alert['message'] : esc_html__( 'The frontend widget is serving the safe visitor fallback response. Please check your provider quota/billing settings.', 'chat-pilot' ) ) : '' ); ?>
				</div>
			</div>
		</div>
		<a href="<?php echo esc_url( admin_url( 'admin.php?page=chat-pilot&tab=providers' ) ); ?>" class="cp-btn cp-btn-sm" style="font-size:0.75rem; background:#dc2626; color:#ffffff; white-space:nowrap; padding:0.4rem 0.8rem; border-radius:6px; text-decoration:none; font-weight:600;">
			<?php esc_html_e( 'Review Provider Settings', 'chat-pilot' ); ?>
		</a>
	</div>

	<!-- Filter Control Bar -->
	<div class="cp-card" style="padding:1.25rem;">
		<form id="cp-analytics-filter-form" style="display:flex; flex-direction:column; gap:1rem;">
			<div style="display:flex; flex-wrap:wrap; gap:1rem; align-items:center; justify-content:space-between;">
				
				<!-- Quick Date Presets -->
				<div style="display:flex; gap:0.35rem; align-items:center; background:rgba(15,23,42,0.6); padding:0.25rem; border-radius:8px; border:1px solid rgba(255,255,255,0.06);">
					<button type="button" class="cp-btn cp-btn-sm cp-analytics-range-btn" data-range="today" style="background:none; border:none; color:var(--text-secondary); padding:0.35rem 0.75rem; font-size:0.8rem; border-radius:6px; font-weight:600; cursor:pointer; font-family:inherit;">
						<?php esc_html_e( 'Today', 'chat-pilot' ); ?>
					</button>
					<button type="button" class="cp-btn cp-btn-sm cp-analytics-range-btn" data-range="7days" style="background:none; border:none; color:var(--text-secondary); padding:0.35rem 0.75rem; font-size:0.8rem; border-radius:6px; font-weight:600; cursor:pointer; font-family:inherit;">
						<?php esc_html_e( 'Last 7 Days', 'chat-pilot' ); ?>
					</button>
					<button type="button" class="cp-btn cp-btn-sm cp-analytics-range-btn cp-active-range" data-range="30days" style="background:var(--accent-cyan); color:#ffffff; padding:0.35rem 0.75rem; font-size:0.8rem; border-radius:6px; font-weight:600; cursor:pointer; font-family:inherit;">
						<?php esc_html_e( 'Last 30 Days', 'chat-pilot' ); ?>
					</button>
					<button type="button" class="cp-btn cp-btn-sm cp-analytics-range-btn" data-range="custom" style="background:none; border:none; color:var(--text-secondary); padding:0.35rem 0.75rem; font-size:0.8rem; border-radius:6px; font-weight:600; cursor:pointer; font-family:inherit;">
						<?php esc_html_e( 'Custom Range', 'chat-pilot' ); ?>
					</button>
				</div>

				<!-- Custom Date Inputs (Hidden by default unless custom is picked) -->
				<div id="cp-analytics-custom-dates" style="display:none; align-items:center; gap:0.5rem;">
					<label style="font-size:0.8rem; color:var(--text-muted); font-weight:600;"><?php esc_html_e( 'From:', 'chat-pilot' ); ?></label>
					<input type="date" id="cp-an-date-from" class="cp-input" style="width:140px; padding:0.35rem 0.6rem; font-size:0.8rem;">
					<label style="font-size:0.8rem; color:var(--text-muted); font-weight:600;"><?php esc_html_e( 'To:', 'chat-pilot' ); ?></label>
					<input type="date" id="cp-an-date-to" class="cp-input" style="width:140px; padding:0.35rem 0.6rem; font-size:0.8rem;">
				</div>

				<input type="hidden" id="cp-an-date-range" value="30days">

				<div style="display:flex; gap:0.5rem; margin-left:auto;">
					<button type="submit" class="cp-btn cp-btn-primary" style="padding:0.4rem 1rem; font-size:0.8rem;">
						🔍 <?php esc_html_e( 'Filter Data', 'chat-pilot' ); ?>
					</button>
					<button type="button" id="cp-analytics-reset-filters" class="cp-btn cp-btn-secondary" style="padding:0.4rem 0.85rem; font-size:0.8rem;">
						🔄 <?php esc_html_e( 'Reset', 'chat-pilot' ); ?>
					</button>
				</div>
			</div>

			<!-- Additional Dropdown Filters -->
			<div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap:0.75rem; border-top:1px solid rgba(255,255,255,0.06); padding-top:0.85rem;">
				<div>
					<label style="display:block; font-size:0.75rem; font-weight:600; color:var(--text-muted); margin-bottom:0.25rem;"><?php esc_html_e( 'Provider', 'chat-pilot' ); ?></label>
					<select id="cp-an-filter-provider" class="cp-select" style="font-size:0.8rem; padding:0.35rem 0.6rem;">
						<option value="all"><?php esc_html_e( 'All Providers', 'chat-pilot' ); ?></option>
						<?php foreach ( $providers as $slug => $p_info ) : ?>
							<option value="<?php echo esc_attr( $slug ); ?>"><?php echo esc_html( isset( $p_info['name'] ) ? $p_info['name'] : ucfirst( $slug ) ); ?></option>
						<?php endforeach; ?>
					</select>
				</div>

				<div>
					<label style="display:block; font-size:0.75rem; font-weight:600; color:var(--text-muted); margin-bottom:0.25rem;"><?php esc_html_e( 'Model', 'chat-pilot' ); ?></label>
					<select id="cp-an-filter-model" class="cp-select" style="font-size:0.8rem; padding:0.35rem 0.6rem;">
						<option value="all"><?php esc_html_e( 'All Models', 'chat-pilot' ); ?></option>
					</select>
				</div>

				<div>
					<label style="display:block; font-size:0.75rem; font-weight:600; color:var(--text-muted); margin-bottom:0.25rem;"><?php esc_html_e( 'Source', 'chat-pilot' ); ?></label>
					<select id="cp-an-filter-source" class="cp-select" style="font-size:0.8rem; padding:0.35rem 0.6rem;">
						<option value="all"><?php esc_html_e( 'All Sources', 'chat-pilot' ); ?></option>
						<option value="widget"><?php esc_html_e( 'Frontend Widget', 'chat-pilot' ); ?></option>
						<option value="playground"><?php esc_html_e( 'Developer Chat Preview', 'chat-pilot' ); ?></option>
					</select>
				</div>

				<div>
					<label style="display:block; font-size:0.75rem; font-weight:600; color:var(--text-muted); margin-bottom:0.25rem;"><?php esc_html_e( 'Form Used', 'chat-pilot' ); ?></label>
					<select id="cp-an-filter-form" class="cp-select" style="font-size:0.8rem; padding:0.35rem 0.6rem;">
						<option value="0"><?php esc_html_e( 'All Forms', 'chat-pilot' ); ?></option>
						<?php foreach ( $all_forms as $f ) : ?>
							<option value="<?php echo esc_attr( $f['id'] ); ?>"><?php echo esc_html( $f['name'] ); ?></option>
						<?php endforeach; ?>
					</select>
				</div>

				<div>
					<label style="display:block; font-size:0.75rem; font-weight:600; color:var(--text-muted); margin-bottom:0.25rem;"><?php esc_html_e( 'Status', 'chat-pilot' ); ?></label>
					<select id="cp-an-filter-status" class="cp-select" style="font-size:0.8rem; padding:0.35rem 0.6rem;">
						<option value="all"><?php esc_html_e( 'All Statuses', 'chat-pilot' ); ?></option>
						<option value="active"><?php esc_html_e( 'Active', 'chat-pilot' ); ?></option>
						<option value="completed"><?php esc_html_e( 'Completed', 'chat-pilot' ); ?></option>
					</select>
				</div>
			</div>
		</form>
	</div>

	<!-- Executive KPI Overview Grid -->
	<div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap:1rem;">
		
		<!-- Total Conversations -->
		<div class="cp-card" style="padding:1.25rem; position:relative; overflow:hidden;">
			<div style="font-size:0.75rem; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:var(--text-muted); margin-bottom:0.5rem;">
				<?php esc_html_e( 'Conversations', 'chat-pilot' ); ?>
			</div>
			<div id="cp-kpi-total-convs" style="font-size:1.8rem; font-weight:800; color:#ffffff; font-family:'Outfit', sans-serif;">
				<?php echo esc_html( $overview['total_conversations'] ); ?>
			</div>
			<div style="display:flex; gap:0.75rem; font-size:0.75rem; color:var(--text-secondary); margin-top:0.4rem;">
				<span>Active: <strong id="cp-kpi-active-convs" style="color:var(--accent-cyan);"><?php echo esc_html( $overview['active_conversations'] ); ?></strong></span>
				<span>Completed: <strong id="cp-kpi-completed-convs" style="color:#10b981;"><?php echo esc_html( $overview['completed_conversations'] ); ?></strong></span>
			</div>
		</div>

		<!-- Visitors & Leads -->
		<div class="cp-card" style="padding:1.25rem; position:relative; overflow:hidden;">
			<div style="font-size:0.75rem; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:var(--text-muted); margin-bottom:0.5rem;">
				<?php esc_html_e( 'Visitors & Leads', 'chat-pilot' ); ?>
			</div>
			<div id="cp-kpi-total-visitors" style="font-size:1.8rem; font-weight:800; color:#ffffff; font-family:'Outfit', sans-serif;">
				<?php echo esc_html( $overview['total_visitors'] ); ?>
			</div>
			<div style="display:flex; gap:0.75rem; font-size:0.75rem; color:var(--text-secondary); margin-top:0.4rem;">
				<span>Leads Captured: <strong id="cp-kpi-total-leads" style="color:#a855f7;"><?php echo esc_html( $overview['total_leads'] ); ?></strong></span>
			</div>
		</div>

		<!-- AI Requests -->
		<div class="cp-card" style="padding:1.25rem; position:relative; overflow:hidden;">
			<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.5rem;">
				<div style="font-size:0.75rem; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:var(--text-muted);">
					<?php esc_html_e( 'AI Generation Requests', 'chat-pilot' ); ?>
				</div>
				<div id="cp-kpi-error-rate-badge" style="font-size:0.7rem; font-weight:600; padding:2px 8px; border-radius:10px; <?php echo ( $initial_data['ai_requests']['failed'] > 0 ) ? 'background:rgba(239,68,68,0.2); color:#ef4444;' : 'background:rgba(16,185,129,0.2); color:#10b981;'; ?>">
					<span id="cp-kpi-error-rate"><?php echo esc_html( $initial_data['ai_requests']['error_rate'] ); ?>%</span> <?php esc_html_e( 'errors', 'chat-pilot' ); ?>
				</div>
			</div>
			<div id="cp-kpi-total-ai-reqs" style="font-size:1.8rem; font-weight:800; color:#ffffff; font-family:'Outfit', sans-serif;">
				<?php echo esc_html( $overview['total_ai_requests'] ); ?>
			</div>
			<div style="display:flex; gap:0.6rem; font-size:0.72rem; color:var(--text-secondary); margin-top:0.4rem; flex-wrap:wrap;">
				<span>Success: <strong id="cp-kpi-ai-successful" style="color:#10b981;"><?php echo esc_html( $initial_data['ai_requests']['successful'] ); ?></strong></span>
				<span>Failed: <strong id="cp-kpi-ai-failed" style="color:<?php echo ( $initial_data['ai_requests']['failed'] > 0 ) ? '#ef4444' : 'var(--text-muted)'; ?>;"><?php echo esc_html( $initial_data['ai_requests']['failed'] ); ?></strong></span>
				<span>Quota/Errors: <strong id="cp-kpi-provider-errors" style="color:<?php echo ( $initial_data['ai_requests']['provider_errors'] > 0 ) ? '#f59e0b' : 'var(--text-muted)'; ?>;"><?php echo esc_html( $initial_data['ai_requests']['provider_errors'] ); ?></strong></span>
			</div>
		</div>

		<!-- Tokens Consumed -->
		<div class="cp-card" style="padding:1.25rem; position:relative; overflow:hidden;">
			<div style="font-size:0.75rem; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:var(--text-muted); margin-bottom:0.5rem;">
				<?php esc_html_e( 'Tokens Consumed', 'chat-pilot' ); ?>
			</div>
			<div id="cp-kpi-total-tokens" style="font-size:1.8rem; font-weight:800; color:#ffffff; font-family:'Outfit', sans-serif;">
				<?php echo esc_html( number_format( $overview['total_tokens'] ) ); ?>
			</div>
			<div style="display:flex; gap:0.5rem; font-size:0.72rem; color:var(--text-secondary); margin-top:0.4rem; flex-wrap:wrap;">
				<span>In: <strong id="cp-kpi-input-tokens"><?php echo esc_html( number_format( $overview['total_input_tokens'] ) ); ?></strong></span>
				<span>Out: <strong id="cp-kpi-output-tokens"><?php echo esc_html( number_format( $overview['total_output_tokens'] ) ); ?></strong></span>
			</div>
		</div>

		<!-- Estimated AI Cost -->
		<div class="cp-card" style="padding:1.25rem; position:relative; overflow:hidden; border-color:rgba(6,182,212,0.3);">
			<div style="font-size:0.75rem; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:var(--accent-cyan); margin-bottom:0.5rem;">
				<?php esc_html_e( 'Estimated AI Cost', 'chat-pilot' ); ?>
			</div>
			<div id="cp-kpi-total-cost" style="font-size:1.8rem; font-weight:800; color:#ffffff; font-family:'Outfit', sans-serif;">
				$<?php echo esc_html( number_format( $overview['estimated_cost'], 4 ) ); ?>
			</div>
			<div style="font-size:0.72rem; color:var(--text-muted); margin-top:0.4rem; display:flex; justify-content:space-between; gap:0.5rem; flex-wrap:wrap;">
				<span>Widget: <strong id="cp-kpi-widget-cost" style="color:#ffffff;">$<?php echo esc_html( number_format( isset( $overview['widget_cost'] ) ? $overview['widget_cost'] : 0, 4 ) ); ?></strong></span>
				<span>Preview: <strong id="cp-kpi-dev-cost" style="color:#ffffff;">$<?php echo esc_html( number_format( isset( $overview['dev_cost'] ) ? $overview['dev_cost'] : 0, 4 ) ); ?></strong></span>
			</div>
		</div>

		<!-- Budget Gauge -->
		<div id="cp-kpi-budget-card" class="cp-card" style="padding:1.25rem; position:relative; overflow:hidden;">
			<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.5rem;">
				<div style="font-size:0.75rem; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:var(--text-muted);">
					<?php esc_html_e( 'Remaining Budget', 'chat-pilot' ); ?>
				</div>
				<div id="cp-kpi-budget-badge" style="font-size:0.7rem; font-weight:600; padding:2px 8px; border-radius:10px; <?php echo ! empty( $overview['is_over_budget'] ) ? 'background:rgba(239,68,68,0.2); color:#ef4444;' : ( $overview['usage_pct'] >= $budget_info['warning_setting'] ? 'background:rgba(245,158,11,0.2); color:#f59e0b;' : 'background:rgba(16,185,129,0.2); color:#10b981;' ); ?>">
					<?php echo ! empty( $overview['is_over_budget'] ) ? esc_html__( 'Over Budget', 'chat-pilot' ) : esc_html( $overview['usage_pct'] . '% used' ); ?>
				</div>
			</div>
			<div id="cp-kpi-remaining-budget" style="font-size:1.8rem; font-weight:800; color:<?php echo ! empty( $overview['is_over_budget'] ) ? '#ef4444' : ( $overview['usage_pct'] >= $budget_info['warning_setting'] ? '#f59e0b' : '#10b981' ); ?>; font-family:'Outfit', sans-serif;">
				$<?php echo esc_html( number_format( $overview['remaining_budget'], 2 ) ); ?>
			</div>
			<div id="cp-kpi-budget-subtext" style="font-size:0.72rem; color:<?php echo ! empty( $overview['is_over_budget'] ) ? '#ef4444' : 'var(--text-muted)'; ?>; margin-top:0.25rem; font-weight:<?php echo ! empty( $overview['is_over_budget'] ) ? '700' : '400'; ?>;">
				<?php 
				if ( ! empty( $overview['is_over_budget'] ) ) {
					printf( esc_html__( '⚠️ Over Budget by $%.2f (Budget: $%.2f)', 'chat-pilot' ), $overview['exceeded_amount'], $overview['monthly_budget'] );
				} else {
					printf( esc_html__( 'Budget: $%.2f ($%s remaining)', 'chat-pilot' ), $overview['monthly_budget'], number_format( $overview['remaining_budget'], 2 ) );
				}
				?>
			</div>
			<div style="margin-top:0.4rem; background:rgba(255,255,255,0.08); height:6px; border-radius:3px; overflow:hidden;">
				<div id="cp-kpi-budget-progress-bar" style="width:<?php echo esc_attr( min( 100, $overview['usage_pct'] ) ); ?>%; height:100%; background:<?php echo ! empty( $overview['is_over_budget'] ) || $overview['usage_pct'] >= 100 ? '#ef4444' : ( $overview['usage_pct'] >= $budget_info['warning_setting'] ? '#f59e0b' : '#10b981' ); ?>;"></div>
			</div>
		</div>
	</div>

	<!-- Interactive Usage Trend Chart Section -->
	<div class="cp-card" style="padding:1.5rem;">
		<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem; flex-wrap:wrap; gap:0.5rem;">
			<h3 style="font-size:1.1rem; font-weight:700; color:#ffffff; margin:0;">
				📈 <?php esc_html_e( 'Usage & Activity Trends', 'chat-pilot' ); ?>
			</h3>
			<div style="display:flex; gap:0.5rem;">
				<select id="cp-chart-metric-select" class="cp-select" style="font-size:0.8rem; padding:0.25rem 0.6rem; width:auto;">
					<option value="conversations"><?php esc_html_e( 'Conversations', 'chat-pilot' ); ?></option>
					<option value="leads"><?php esc_html_e( 'Leads Captured', 'chat-pilot' ); ?></option>
					<option value="ai_requests"><?php esc_html_e( 'AI Requests', 'chat-pilot' ); ?></option>
					<option value="tokens" selected><?php esc_html_e( 'Token Usage', 'chat-pilot' ); ?></option>
					<option value="cost"><?php esc_html_e( 'Estimated Cost ($)', 'chat-pilot' ); ?></option>
				</select>
			</div>
		</div>

		<!-- SVG Trend Chart Render Container -->
		<div id="cp-analytics-chart-container" style="width:100%; height:260px; position:relative; background:rgba(15,23,42,0.4); border-radius:10px; border:1px solid rgba(255,255,255,0.05); padding:1rem;">
			<!-- Rendered dynamically by JS -->
		</div>
	</div>

	<!-- Two Column Detailed Breakdown Matrix -->
	<div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap:1.5rem;">

		<!-- Provider & Model Analytics Table -->
		<div class="cp-card" style="padding:1.5rem; display:flex; flex-direction:column;">
			<h3 style="font-size:1.05rem; font-weight:700; color:#ffffff; margin:0 0 1rem 0; display:flex; align-items:center; gap:0.5rem;">
				<span>🤖</span> <?php esc_html_e( 'AI Provider & Model Breakdown', 'chat-pilot' ); ?>
			</h3>

			<div style="overflow-x:auto; flex-grow:1;">
				<table class="cp-table" style="width:100%; font-size:0.82rem;">
					<thead>
						<tr>
							<th><?php esc_html_e( 'Model', 'chat-pilot' ); ?></th>
							<th><?php esc_html_e( 'Requests', 'chat-pilot' ); ?></th>
							<th><?php esc_html_e( 'Total Tokens', 'chat-pilot' ); ?></th>
							<th><?php esc_html_e( 'Avg Latency', 'chat-pilot' ); ?></th>
							<th><?php esc_html_e( 'Est. Cost', 'chat-pilot' ); ?></th>
						</tr>
					</thead>
					<tbody id="cp-an-tbody-models">
						<!-- Rendered dynamically -->
					</tbody>
				</table>
			</div>
		</div>

		<!-- Knowledge Base Performance & Retrieval Sources -->
		<div class="cp-card" style="padding:1.5rem; display:flex; flex-direction:column;">
			<h3 style="font-size:1.05rem; font-weight:700; color:#ffffff; margin:0 0 1rem 0; display:flex; align-items:center; gap:0.5rem;">
				<span>🧠</span> <?php esc_html_e( 'Knowledge Base & RAG Performance', 'chat-pilot' ); ?>
			</h3>

			<div style="display:grid; grid-template-columns:1fr 1fr; gap:1rem; margin-bottom:1.25rem;">
				<div style="background:rgba(15,23,42,0.6); padding:0.85rem; border-radius:8px; border:1px solid rgba(255,255,255,0.05); text-align:center;">
					<div style="font-size:0.75rem; color:var(--text-muted);"><?php esc_html_e( 'Retrieval Success Rate', 'chat-pilot' ); ?></div>
					<div id="cp-kb-success-rate" style="font-size:1.5rem; font-weight:800; color:#10b981; margin-top:0.25rem;">
						<?php echo esc_html( $initial_data['kb_performance']['success_rate'] ); ?>%
					</div>
				</div>
				<div style="background:rgba(15,23,42,0.6); padding:0.85rem; border-radius:8px; border:1px solid rgba(255,255,255,0.05); text-align:center;">
					<div style="font-size:0.75rem; color:var(--text-muted);"><?php esc_html_e( 'Avg Similarity Score', 'chat-pilot' ); ?></div>
					<div id="cp-kb-avg-similarity" style="font-size:1.5rem; font-weight:800; color:var(--accent-cyan); margin-top:0.25rem;">
						<?php echo esc_html( $initial_data['kb_performance']['avg_similarity'] ); ?>
					</div>
				</div>
			</div>

			<!-- Source Breakdown List -->
			<div style="display:flex; flex-direction:column; gap:0.6rem; font-size:0.82rem;">
				<div style="display:flex; justify-content:space-between; align-items:center;">
					<span style="color:var(--text-secondary);">📚 FAQ Retrieval Events:</span>
					<strong id="cp-kb-faq-count"><?php echo esc_html( $initial_data['kb_performance']['faq_count'] ); ?></strong>
				</div>
				<div style="display:flex; justify-content:space-between; align-items:center;">
					<span style="color:var(--text-secondary);">📝 Manual Knowledge Events:</span>
					<strong id="cp-kb-manual-count"><?php echo esc_html( $initial_data['kb_performance']['manual_count'] ); ?></strong>
				</div>
				<div style="display:flex; justify-content:space-between; align-items:center;">
					<span style="color:var(--text-secondary);">📁 Document File Events:</span>
					<strong id="cp-kb-doc-count"><?php echo esc_html( $initial_data['kb_performance']['doc_count'] ); ?></strong>
				</div>
				<div style="display:flex; justify-content:space-between; align-items:center;">
					<span style="color:var(--text-secondary);">🌐 Website Crawler Events:</span>
					<strong id="cp-kb-website-count"><?php echo esc_html( $initial_data['kb_performance']['website_count'] ); ?></strong>
				</div>
				<div style="display:flex; justify-content:space-between; align-items:center; border-top:1px dashed rgba(255,255,255,0.08); padding-top:0.5rem; color:#ef4444;">
					<span>⚠️ Fallback / Low Confidence Events:</span>
					<strong id="cp-kb-fallback-count"><?php echo esc_html( $initial_data['kb_performance']['fallback_count'] ); ?></strong>
				</div>
			</div>
		</div>

	</div>

	<!-- AI Provider Operational Health Monitor -->
	<div class="cp-card" style="padding:1.5rem;">
		<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem; flex-wrap:wrap; gap:0.5rem;">
			<h3 style="font-size:1.05rem; font-weight:700; color:#ffffff; margin:0; display:flex; align-items:center; gap:0.5rem;">
				<span>🩺</span> <?php esc_html_e( 'AI Provider Operational Health Monitor', 'chat-pilot' ); ?>
			</h3>
			<span style="font-size:0.75rem; color:var(--text-muted);">
				<?php esc_html_e( 'Real-time connectivity and upstream quota health', 'chat-pilot' ); ?>
			</span>
		</div>

		<div id="cp-provider-health-grid" style="display:grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap:1rem;">
			<?php
			$providers_health = isset( $initial_data['provider_health'] ) ? $initial_data['provider_health'] : array();
			foreach ( $providers_health as $ph ) :
				$is_op       = ( 'operational' === $ph['operational_status'] );
				$is_quota    = ( 'quota_exceeded' === $ph['operational_status'] );
				$badge_bg    = $is_op ? 'rgba(16,185,129,0.15)' : ( $is_quota ? 'rgba(239,68,68,0.2)' : 'rgba(245,158,11,0.2)' );
				$badge_color = $is_op ? '#10b981' : ( $is_quota ? '#ef4444' : '#f59e0b' );
			?>
			<div class="cp-provider-health-card" data-slug="<?php echo esc_attr( $ph['slug'] ); ?>" style="background:rgba(15,23,42,0.6); border:1px solid <?php echo $is_op ? 'rgba(255,255,255,0.06)' : 'rgba(239,68,68,0.3)'; ?>; border-radius:10px; padding:1rem; display:flex; flex-direction:column; gap:0.75rem;">
				<div style="display:flex; justify-content:space-between; align-items:center;">
					<div style="font-weight:700; color:#ffffff; font-size:0.95rem; display:flex; align-items:center; gap:0.4rem;">
						<span><?php echo esc_html( $ph['name'] ); ?></span>
						<?php if ( ! empty( $ph['is_active'] ) ) : ?>
							<span style="background:rgba(6,182,212,0.2); color:var(--accent-cyan); font-size:0.65rem; padding:1px 6px; border-radius:4px; font-weight:600; text-transform:uppercase;">Active</span>
						<?php endif; ?>
					</div>
					<div class="cp-health-op-badge" style="font-size:0.72rem; font-weight:700; padding:2px 8px; border-radius:12px; background:<?php echo esc_attr( $badge_bg ); ?>; color:<?php echo esc_attr( $badge_color ); ?>;">
						<?php echo esc_html( $ph['operational_label'] ); ?>
					</div>
				</div>

				<div style="display:grid; grid-template-columns: 1fr 1fr; gap:0.5rem; font-size:0.78rem; color:var(--text-secondary); background:rgba(0,0,0,0.2); padding:0.6rem 0.75rem; border-radius:6px;">
					<div>
						<span style="color:var(--text-muted); display:block; font-size:0.7rem;">Configuration</span>
						<strong style="color:<?php echo ( 'Connected' === $ph['configuration_status'] ) ? '#10b981' : 'var(--text-muted)'; ?>;">
							<?php echo esc_html( $ph['configuration_status'] ); ?>
						</strong>
					</div>
					<div>
						<span style="color:var(--text-muted); display:block; font-size:0.7rem;">Operational State</span>
						<strong class="cp-health-op-state" style="color:<?php echo esc_attr( $badge_color ); ?>;">
							<?php echo esc_html( $ph['operational_label'] ); ?>
						</strong>
					</div>
				</div>

				<?php if ( ! empty( $ph['last_error'] ) ) : ?>
				<div class="cp-health-last-error" style="font-size:0.73rem; color:#fca5a5; background:rgba(239,68,68,0.08); border:1px solid rgba(239,68,68,0.15); border-radius:6px; padding:0.4rem 0.6rem; word-break:break-word;">
					<span style="font-weight:600;">Last Event:</span> <?php echo esc_html( $ph['last_error'] ); ?>
					<?php if ( ! empty( $ph['last_error_time'] ) ) : ?>
						<span style="display:block; color:var(--text-muted); font-size:0.68rem; margin-top:2px;"><?php echo esc_html( $ph['last_error_time'] ); ?></span>
					<?php endif; ?>
				</div>
				<?php else : ?>
				<div class="cp-health-last-error" style="display:none; font-size:0.73rem; color:#fca5a5; background:rgba(239,68,68,0.08); border:1px solid rgba(239,68,68,0.15); border-radius:6px; padding:0.4rem 0.6rem; word-break:break-word;"></div>
				<?php endif; ?>
			</div>
			<?php endforeach; ?>
		</div>
	</div>

	<!-- Visitor Telemetry Table -->
	<div class="cp-card" style="padding:1.5rem;">
		<h3 style="font-size:1.05rem; font-weight:700; color:#ffffff; margin:0 0 1rem 0; display:flex; align-items:center; gap:0.5rem;">
			<span>👥</span> <?php esc_html_e( 'Visitor-Level Usage Telemetry', 'chat-pilot' ); ?>
		</h3>

		<div style="overflow-x:auto;">
			<table class="cp-table" style="width:100%; font-size:0.85rem;">
				<thead>
					<tr>
						<th><?php esc_html_e( 'Visitor Name / Identifier', 'chat-pilot' ); ?></th>
						<th><?php esc_html_e( 'Contact Info', 'chat-pilot' ); ?></th>
						<th><?php esc_html_e( 'Conversations', 'chat-pilot' ); ?></th>
						<th><?php esc_html_e( 'AI Requests', 'chat-pilot' ); ?></th>
						<th><?php esc_html_e( 'Input Tokens', 'chat-pilot' ); ?></th>
						<th><?php esc_html_e( 'Output Tokens', 'chat-pilot' ); ?></th>
						<th><?php esc_html_e( 'Total Tokens', 'chat-pilot' ); ?></th>
						<th><?php esc_html_e( 'Estimated Cost', 'chat-pilot' ); ?></th>
					</tr>
				</thead>
				<tbody id="cp-an-tbody-visitors">
					<!-- Rendered dynamically -->
				</tbody>
			</table>
		</div>
	</div>

	<!-- Budget Management Card -->
	<div id="cp-budget-card-anchor" class="cp-card" style="padding:1.5rem;">
		<h3 style="font-size:1.05rem; font-weight:700; color:#ffffff; margin:0 0 1rem 0; display:flex; align-items:center; gap:0.5rem;">
			<span>💳</span> <?php esc_html_e( 'Internal AI Budget Management', 'chat-pilot' ); ?>
		</h3>

		<form id="cp-analytics-budget-form" style="display:flex; flex-wrap:wrap; gap:1.25rem; align-items:flex-end;">
			<div style="flex-grow:1; min-width:200px;">
				<label style="display:block; font-size:0.8rem; font-weight:600; color:var(--text-secondary); margin-bottom:0.35rem;">
					<?php esc_html_e( 'Monthly AI Budget (USD)', 'chat-pilot' ); ?>
				</label>
				<div style="position:relative;">
					<span style="position:absolute; left:12px; top:50%; transform:translateY(-50%); color:var(--text-muted); font-weight:600;">$</span>
					<input type="number" step="0.01" min="1" id="cp-budget-monthly-input" class="cp-input" style="padding-left:1.8rem; font-size:0.9rem;" value="<?php echo esc_attr( $budget_info['monthly_budget'] ); ?>">
				</div>
			</div>

			<div style="flex-grow:1; min-width:200px;">
				<label style="display:block; font-size:0.8rem; font-weight:600; color:var(--text-secondary); margin-bottom:0.35rem;">
					<?php esc_html_e( 'Warning Notification Threshold', 'chat-pilot' ); ?>
				</label>
				<select id="cp-budget-threshold-input" class="cp-select" style="font-size:0.9rem;">
					<option value="70" <?php selected( $budget_info['warning_setting'], 70 ); ?>>70% of Budget</option>
					<option value="80" <?php selected( $budget_info['warning_setting'], 80 ); ?>>80% of Budget</option>
					<option value="90" <?php selected( $budget_info['warning_setting'], 90 ); ?>>90% of Budget</option>
					<option value="100" <?php selected( $budget_info['warning_setting'], 100 ); ?>>100% of Budget</option>
				</select>
			</div>

			<div>
				<button type="submit" class="cp-btn cp-btn-primary" style="font-size:0.85rem; padding:0.6rem 1.25rem;">
					💾 <?php esc_html_e( 'Save Budget Settings', 'chat-pilot' ); ?>
				</button>
			</div>
		</form>
		<div style="margin-top:1.25rem; padding-top:0.85rem; border-top:1px solid rgba(255,255,255,0.06); font-size:0.75rem; color:var(--text-muted); display:flex; align-items:center; gap:0.5rem;">
			<span>ℹ️</span>
			<span><?php esc_html_e( "Note: Chat Pilot's internal budget is calculated dynamically from model token usage rates for the selected period. This internal safety limit does not reflect or modify your live OpenAI/Gemini account balance or external API billing quota.", 'chat-pilot' ); ?></span>
		</div>
	</div>

</div>
