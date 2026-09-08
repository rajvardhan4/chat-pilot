<?php
/**
 * Tab Settings Template
 * Central Executive Configuration Dashboard for Chat Pilot.
 */

// Prevent direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$plugin               = \ChatPilot\Core\Plugin::instance();
$settings             = $plugin->settings;
$form_mgr             = new \ChatPilot\Forms\FormManager();
$available_providers  = $plugin->providers->get_available_providers();

// Fetch settings values
$general              = $settings->get( 'general', array() );
$ai_defaults          = $settings->get( 'ai_defaults', array() );
$conversations        = $settings->get( 'conversations', array() );
$privacy              = $settings->get( 'privacy', array() );
$notifications        = $settings->get( 'notifications', array() );
$performance          = $settings->get( 'performance', array() );
$security             = $settings->get( 'security', array() );
$developer            = $settings->get( 'developer', array() );
$kb_threshold         = $settings->get( 'knowledge_base.retrieval_threshold', 3.0 );
$system_info          = $settings->get( 'system', array() );

$active_provider      = ! empty( $ai_defaults['default_provider'] ) ? $ai_defaults['default_provider'] : $settings->get( 'default_provider', 'gemini' );
$active_model         = ! empty( $ai_defaults['default_model'] ) ? $ai_defaults['default_model'] : $settings->get( 'default_model', 'gemini-3.6-flash' );
$active_models_list   = isset( $available_providers[ $active_provider ]['models'] ) ? $available_providers[ $active_provider ]['models'] : array();

global $wpdb;
$logs_count           = $wpdb->get_var( "SELECT COUNT(*) FROM {$wpdb->prefix}chat_pilot_logs" );
$convs_count          = $wpdb->get_var( "SELECT COUNT(*) FROM {$wpdb->prefix}chat_pilot_conversations" );
?>

<div class="cp-settings-center-wrap" style="display:flex; flex-direction:column; gap:1.5rem;">

	<!-- Top Title & Navigation Bar -->
	<div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:1rem; border-bottom:1px solid rgba(255,255,255,0.06); padding-bottom:1rem;">
		<div>
			<h1 style="font-family:'Outfit', sans-serif; font-size:1.6rem; font-weight:800; color:#ffffff; margin:0 0 0.25rem 0;">
				<?php esc_html_e( 'Global Settings & System Center', 'chat-pilot' ); ?>
			</h1>
			<p style="font-size:0.85rem; color:var(--text-muted); margin:0;">
				<?php esc_html_e( 'Manage global defaults, conversation timeouts, privacy rules, notifications, performance, and maintenance utilities.', 'chat-pilot' ); ?>
			</p>
		</div>
		<div>
			<button type="submit" form="cp-settings-main-form" class="cp-btn cp-btn-primary" style="font-size:0.85rem; padding:0.6rem 1.25rem; display:inline-flex; align-items:center; gap:0.5rem;">
				<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
				<?php esc_html_e( 'Save All Settings', 'chat-pilot' ); ?>
			</button>
		</div>
	</div>

	<div style="display:grid; grid-template-columns: 240px 1fr; gap:1.5rem;">
		
		<!-- Left Sidebar Section Navigation -->
		<div>
			<div class="cp-card" style="padding:0.75rem; position:sticky; top:1rem;">
				<nav class="cp-settings-nav" style="display:flex; flex-direction:column; gap:0.25rem;">
					<button type="button" class="cp-st-nav-btn active" data-target="cp-st-sec-general" style="display:flex; align-items:center; gap:0.6rem; width:100%; padding:0.65rem 0.85rem; border-radius:6px; border:none; background:rgba(6,182,212,0.15); color:var(--accent-cyan); font-weight:600; font-size:0.82rem; text-align:left; cursor:pointer;">
						<span>⚙️</span> <?php esc_html_e( 'General Settings', 'chat-pilot' ); ?>
					</button>
					<button type="button" class="cp-st-nav-btn" data-target="cp-st-sec-conversations" style="display:flex; align-items:center; gap:0.6rem; width:100%; padding:0.65rem 0.85rem; border-radius:6px; border:none; background:none; color:var(--text-secondary); font-weight:600; font-size:0.82rem; text-align:left; cursor:pointer;">
						<span>💬</span> <?php esc_html_e( 'Conversations', 'chat-pilot' ); ?>
					</button>
					<button type="button" class="cp-st-nav-btn" data-target="cp-st-sec-privacy" style="display:flex; align-items:center; gap:0.6rem; width:100%; padding:0.65rem 0.85rem; border-radius:6px; border:none; background:none; color:var(--text-secondary); font-weight:600; font-size:0.82rem; text-align:left; cursor:pointer;">
						<span>🔒</span> <?php esc_html_e( 'Privacy & Data', 'chat-pilot' ); ?>
					</button>
					<button type="button" class="cp-st-nav-btn" data-target="cp-st-sec-notifications" style="display:flex; align-items:center; gap:0.6rem; width:100%; padding:0.65rem 0.85rem; border-radius:6px; border:none; background:none; color:var(--text-secondary); font-weight:600; font-size:0.82rem; text-align:left; cursor:pointer;">
						<span>🔔</span> <?php esc_html_e( 'Notifications', 'chat-pilot' ); ?>
					</button>
					<button type="button" class="cp-st-nav-btn" data-target="cp-st-sec-performance" style="display:flex; align-items:center; gap:0.6rem; width:100%; padding:0.65rem 0.85rem; border-radius:6px; border:none; background:none; color:var(--text-secondary); font-weight:600; font-size:0.82rem; text-align:left; cursor:pointer;">
						<span>⚡</span> <?php esc_html_e( 'Performance', 'chat-pilot' ); ?>
					</button>
					<button type="button" class="cp-st-nav-btn" data-target="cp-st-sec-security" style="display:flex; align-items:center; gap:0.6rem; width:100%; padding:0.65rem 0.85rem; border-radius:6px; border:none; background:none; color:var(--text-secondary); font-weight:600; font-size:0.82rem; text-align:left; cursor:pointer;">
						<span>🛡️</span> <?php esc_html_e( 'Security', 'chat-pilot' ); ?>
					</button>
					<button type="button" class="cp-st-nav-btn" data-target="cp-st-sec-developer" style="display:flex; align-items:center; gap:0.6rem; width:100%; padding:0.65rem 0.85rem; border-radius:6px; border:none; background:none; color:var(--text-secondary); font-weight:600; font-size:0.82rem; text-align:left; cursor:pointer;">
						<span>🛠️</span> <?php esc_html_e( 'Developer Mode', 'chat-pilot' ); ?>
					</button>
					<button type="button" class="cp-st-nav-btn" data-target="cp-st-sec-maintenance" style="display:flex; align-items:center; gap:0.6rem; width:100%; padding:0.65rem 0.85rem; border-radius:6px; border:none; background:none; color:#ef4444; font-weight:600; font-size:0.82rem; text-align:left; cursor:pointer;">
						<span>🧰</span> <?php esc_html_e( 'Maintenance', 'chat-pilot' ); ?>
					</button>
				</nav>
			</div>
		</div>

		<!-- Main Settings Content Form -->
		<div>
			<form id="cp-settings-main-form">

				<!-- SECTION 1: GENERAL SETTINGS -->
				<div id="cp-st-sec-general" class="cp-settings-section cp-card" style="padding:1.5rem; display:block;">
					<h2 class="cp-card-title" style="margin-bottom:1.25rem;">
						<span>⚙️</span> <?php esc_html_e( 'General Settings', 'chat-pilot' ); ?>
					</h2>

					<div class="cp-form-group" style="margin-bottom:1.25rem;">
						<label class="cp-checkbox-label">
							<input type="checkbox" name="general[enable_plugin]" class="cp-checkbox" value="1" <?php checked( isset( $general['enable_plugin'] ) ? $general['enable_plugin'] : true ); ?>>
							<span><strong><?php esc_html_e( 'Enable Chat Pilot Engine', 'chat-pilot' ); ?></strong></span>
						</label>
						<p class="cp-description">
							<?php esc_html_e( 'Master operational switch. When disabled, frontend widgets and background chat processing are paused.', 'chat-pilot' ); ?>
						</p>
					</div>

					<div class="cp-form-group" style="margin-bottom:1.25rem;">
						<label class="cp-label" for="st_plugin_name"><?php esc_html_e( 'Plugin Display Name', 'chat-pilot' ); ?></label>
						<input type="text" id="st_plugin_name" name="general[plugin_name]" class="cp-input-text" value="<?php echo esc_attr( isset( $general['plugin_name'] ) ? $general['plugin_name'] : 'Chat Pilot' ); ?>">
						<p class="cp-description">
							<?php esc_html_e( 'Global brand name displayed across administrative headers and automated messaging.', 'chat-pilot' ); ?>
						</p>
					</div>

					<div class="cp-form-group" style="margin-bottom:1.25rem;">
						<label class="cp-label" for="st_default_language"><?php esc_html_e( 'Default System Language', 'chat-pilot' ); ?></label>
						<select id="st_default_language" name="general[default_language]" class="cp-select">
							<option value="en" <?php selected( isset( $general['default_language'] ) ? $general['default_language'] : 'en', 'en' ); ?>>English (en)</option>
							<option value="es" <?php selected( isset( $general['default_language'] ) ? $general['default_language'] : 'en', 'es' ); ?>>Español (es)</option>
							<option value="fr" <?php selected( isset( $general['default_language'] ) ? $general['default_language'] : 'en', 'fr' ); ?>>Français (fr)</option>
							<option value="de" <?php selected( isset( $general['default_language'] ) ? $general['default_language'] : 'en', 'de' ); ?>>Deutsch (de)</option>
							<option value="it" <?php selected( isset( $general['default_language'] ) ? $general['default_language'] : 'en', 'it' ); ?>>Italiano (it)</option>
							<option value="pt" <?php selected( isset( $general['default_language'] ) ? $general['default_language'] : 'en', 'pt' ); ?>>Português (pt)</option>
							<option value="wp" <?php selected( isset( $general['default_language'] ) ? $general['default_language'] : 'en', 'wp' ); ?>>Inherit WordPress Site Language</option>
						</select>
						<p class="cp-description">
							<?php esc_html_e( 'Primary language fallback for widget strings and AI prompts.', 'chat-pilot' ); ?>
						</p>
					</div>

					<div class="cp-form-group">
						<label class="cp-label" for="st_timezone_mode"><?php esc_html_e( 'Timezone Behavior', 'chat-pilot' ); ?></label>
						<select id="st_timezone_mode" name="general[timezone_mode]" class="cp-select">
							<option value="site" <?php selected( isset( $general['timezone_mode'] ) ? $general['timezone_mode'] : 'site', 'site' ); ?>>Use WordPress Site Timezone</option>
							<option value="utc" <?php selected( isset( $general['timezone_mode'] ) ? $general['timezone_mode'] : 'site', 'utc' ); ?>>Coordinated Universal Time (UTC)</option>
						</select>
						<p class="cp-description">
							<?php esc_html_e( 'Determines timestamp formatting across Analytics, Conversations, and System Logs.', 'chat-pilot' ); ?>
						</p>
					</div>
				</div>

				<!-- SECTION 2: CONVERSATION SETTINGS -->
				<div id="cp-st-sec-conversations" class="cp-settings-section cp-card" style="padding:1.5rem; display:none;">
					<h2 class="cp-card-title" style="margin-bottom:1.25rem;">
						<span>💬</span> <?php esc_html_e( 'Conversation Settings', 'chat-pilot' ); ?>
					</h2>

					<div class="cp-form-group" style="margin-bottom:1.25rem;">
						<label class="cp-label" for="st_conv_timeout"><?php esc_html_e( 'Inactivity / Session Timeout (Minutes)', 'chat-pilot' ); ?></label>
						<input type="number" id="st_conv_timeout" name="conversations[inactivity_timeout]" class="cp-input-text" min="5" max="1440" value="<?php echo esc_attr( isset( $conversations['inactivity_timeout'] ) ? $conversations['inactivity_timeout'] : 30 ); ?>">
						<p class="cp-description">
							<?php esc_html_e( 'Minutes of visitor inactivity after which an active chat session automatically transitions to completed.', 'chat-pilot' ); ?>
						</p>
					</div>

					<div class="cp-form-group" style="margin-bottom:1.25rem;">
						<label class="cp-label" for="st_conv_retention"><?php esc_html_e( 'Conversation Retention Period (Days)', 'chat-pilot' ); ?></label>
						<input type="number" id="st_conv_retention" name="conversations[retention_days]" class="cp-input-text" min="0" max="3650" value="<?php echo esc_attr( isset( $conversations['retention_days'] ) ? $conversations['retention_days'] : 90 ); ?>">
						<p class="cp-description">
							<?php esc_html_e( 'Days to retain conversation records before automated cleanup. Set to 0 to keep conversations indefinitely.', 'chat-pilot' ); ?>
						</p>
					</div>

					<div class="cp-form-group" style="margin-bottom:1.25rem;">
						<label class="cp-label" for="st_conv_max_history"><?php esc_html_e( 'Maximum History Messages in AI Context', 'chat-pilot' ); ?></label>
						<input type="number" id="st_conv_max_history" name="conversations[max_history_messages]" class="cp-input-text" min="2" max="100" value="<?php echo esc_attr( isset( $conversations['max_history_messages'] ) ? $conversations['max_history_messages'] : 20 ); ?>">
						<p class="cp-description">
							<?php esc_html_e( 'Maximum previous dialogue turns sent to the LLM model to maintain chat memory while conserving tokens.', 'chat-pilot' ); ?>
						</p>
					</div>

					<div class="cp-form-group">
						<label class="cp-label" for="st_conv_default_status"><?php esc_html_e( 'Default New Conversation Status', 'chat-pilot' ); ?></label>
						<select id="st_conv_default_status" name="conversations[default_status]" class="cp-select">
							<option value="active" <?php selected( isset( $conversations['default_status'] ) ? $conversations['default_status'] : 'active', 'active' ); ?>>Active</option>
							<option value="completed" <?php selected( isset( $conversations['default_status'] ) ? $conversations['default_status'] : 'active', 'completed' ); ?>>Completed</option>
						</select>
					</div>
				</div>

				<!-- SECTION 4: PRIVACY & DATA -->
				<div id="cp-st-sec-privacy" class="cp-settings-section cp-card" style="padding:1.5rem; display:none;">
					<h2 class="cp-card-title" style="margin-bottom:1.25rem;">
						<span>🔒</span> <?php esc_html_e( 'Privacy & Data Protection', 'chat-pilot' ); ?>
					</h2>

					<div class="cp-form-group" style="margin-bottom:1.25rem;">
						<label class="cp-checkbox-label">
							<input type="checkbox" name="privacy[store_conversations]" class="cp-checkbox" value="1" <?php checked( isset( $privacy['store_conversations'] ) ? $privacy['store_conversations'] : true ); ?>>
							<span><?php esc_html_e( 'Store Visitor Conversation Records in Database', 'chat-pilot' ); ?></span>
						</label>
						<p class="cp-description">
							<?php esc_html_e( 'When unchecked, conversations are processed ephemerally in memory without writing transcript rows.', 'chat-pilot' ); ?>
						</p>
					</div>

					<div class="cp-form-group" style="margin-bottom:1.25rem;">
						<label class="cp-checkbox-label">
							<input type="checkbox" name="privacy[store_visitor_info]" class="cp-checkbox" value="1" <?php checked( isset( $privacy['store_visitor_info'] ) ? $privacy['store_visitor_info'] : true ); ?>>
							<span><?php esc_html_e( 'Store Visitor Contact Details (Name, Email, Phone)', 'chat-pilot' ); ?></span>
						</label>
						<p class="cp-description">
							<?php esc_html_e( 'Permits lead form submissions to record contact details alongside session tokens.', 'chat-pilot' ); ?>
						</p>
					</div>

					<div class="cp-form-group" style="margin-bottom:1.25rem;">
						<label class="cp-checkbox-label">
							<input type="checkbox" name="privacy[anonymize_ips]" class="cp-checkbox" value="1" <?php checked( isset( $privacy['anonymize_ips'] ) ? $privacy['anonymize_ips'] : true ); ?>>
							<span><?php esc_html_e( 'Anonymize Visitor IP Addresses', 'chat-pilot' ); ?></span>
						</label>
						<p class="cp-description">
							<?php esc_html_e( 'Masks visitor IP addresses before logging or storing analytics records.', 'chat-pilot' ); ?>
						</p>
					</div>

					<div class="cp-form-group" style="margin-bottom:1.25rem;">
						<label class="cp-label" for="st_privacy_retention"><?php esc_html_e( 'General Data Retention Period (Days)', 'chat-pilot' ); ?></label>
						<input type="number" id="st_privacy_retention" name="privacy[data_retention_days]" class="cp-input-text" min="0" max="3650" value="<?php echo esc_attr( isset( $privacy['data_retention_days'] ) ? $privacy['data_retention_days'] : 90 ); ?>">
					</div>

					<div class="cp-form-group">
						<label class="cp-checkbox-label">
							<input type="checkbox" name="privacy[delete_on_uninstall]" class="cp-checkbox" value="1" <?php checked( isset( $privacy['delete_on_uninstall'] ) ? $privacy['delete_on_uninstall'] : false ); ?>>
							<span style="color:#ef4444; font-weight:600;"><?php esc_html_e( 'Purge All Plugin Data On Uninstall', 'chat-pilot' ); ?></span>
						</label>
						<p class="cp-description">
							<?php esc_html_e( 'When enabled, completely drops all database tables (conversations, forms, logs, sources) when plugin is deleted.', 'chat-pilot' ); ?>
						</p>
					</div>
				</div>

				<!-- SECTION 5: NOTIFICATIONS -->
				<div id="cp-st-sec-notifications" class="cp-settings-section cp-card" style="padding:1.5rem; display:none;">
					<h2 class="cp-card-title" style="margin-bottom:1.25rem;">
						<span>🔔</span> <?php esc_html_e( 'System & Lead Notifications', 'chat-pilot' ); ?>
					</h2>

					<div class="cp-form-group" style="margin-bottom:1.25rem;">
						<label class="cp-checkbox-label">
							<input type="checkbox" name="notifications[enable_admin_notifications]" class="cp-checkbox" value="1" <?php checked( isset( $notifications['enable_admin_notifications'] ) ? $notifications['enable_admin_notifications'] : true ); ?>>
							<span><strong><?php esc_html_e( 'Enable Admin Email Notifications', 'chat-pilot' ); ?></strong></span>
						</label>
					</div>

					<div class="cp-form-group" style="margin-bottom:1.25rem;">
						<label class="cp-label" for="st_notification_email"><?php esc_html_e( 'Notification Recipient Email', 'chat-pilot' ); ?></label>
						<input type="email" id="st_notification_email" name="notifications[notification_email]" class="cp-input-text" value="<?php echo esc_attr( isset( $notifications['notification_email'] ) ? $notifications['notification_email'] : get_option( 'admin_email' ) ); ?>">
						<p class="cp-description">
							<?php esc_html_e( 'Destination email for lead notifications, system alerts, and budget warnings.', 'chat-pilot' ); ?>
						</p>
					</div>

					<div class="cp-form-group" style="margin-bottom:1.25rem;">
						<label class="cp-checkbox-label">
							<input type="checkbox" name="notifications[notify_on_lead]" class="cp-checkbox" value="1" <?php checked( isset( $notifications['notify_on_lead'] ) ? $notifications['notify_on_lead'] : true ); ?>>
							<span><?php esc_html_e( 'Send Email Alert On New Lead Capture', 'chat-pilot' ); ?></span>
						</label>
					</div>

					<div class="cp-form-group" style="margin-bottom:1.25rem;">
						<label class="cp-checkbox-label">
							<input type="checkbox" name="notifications[notify_on_conversation]" class="cp-checkbox" value="1" <?php checked( isset( $notifications['notify_on_conversation'] ) ? $notifications['notify_on_conversation'] : false ); ?>>
							<span><?php esc_html_e( 'Send Email Alert On New Conversation Start', 'chat-pilot' ); ?></span>
						</label>
					</div>

					<div class="cp-form-group">
						<label class="cp-checkbox-label">
							<input type="checkbox" name="notifications[notify_on_budget_warning]" class="cp-checkbox" value="1" <?php checked( isset( $notifications['notify_on_budget_warning'] ) ? $notifications['notify_on_budget_warning'] : true ); ?>>
							<span><?php esc_html_e( 'Send Email Alert When AI Budget Threshold Reached', 'chat-pilot' ); ?></span>
						</label>
					</div>
				</div>

				<!-- SECTION 6: PERFORMANCE -->
				<div id="cp-st-sec-performance" class="cp-settings-section cp-card" style="padding:1.5rem; display:none;">
					<h2 class="cp-card-title" style="margin-bottom:1.25rem;">
						<span>⚡</span> <?php esc_html_e( 'Performance & Logging', 'chat-pilot' ); ?>
					</h2>

					<div class="cp-form-group" style="margin-bottom:1.25rem;">
						<label class="cp-checkbox-label">
							<input type="checkbox" name="performance[enable_logging]" class="cp-checkbox" value="1" <?php checked( isset( $performance['enable_logging'] ) ? $performance['enable_logging'] : true ); ?>>
							<span><strong><?php esc_html_e( 'Enable System Event Database Logging', 'chat-pilot' ); ?></strong></span>
						</label>
					</div>

					<div class="cp-form-group" style="margin-bottom:1.25rem;">
						<label class="cp-label" for="st_logging_level"><?php esc_html_e( 'Log Severity Level Threshold', 'chat-pilot' ); ?></label>
						<select id="st_logging_level" name="performance[logging_level]" class="cp-select">
							<option value="debug" <?php selected( isset( $performance['logging_level'] ) ? $performance['logging_level'] : 'info', 'debug' ); ?>>Debug (Log Everything)</option>
							<option value="info" <?php selected( isset( $performance['logging_level'] ) ? $performance['logging_level'] : 'info', 'info' ); ?>>Info (General Events & Errors)</option>
							<option value="warning" <?php selected( isset( $performance['logging_level'] ) ? $performance['logging_level'] : 'info', 'warning' ); ?>>Warning (Warnings & Errors Only)</option>
							<option value="error" <?php selected( isset( $performance['logging_level'] ) ? $performance['logging_level'] : 'info', 'error' ); ?>>Error (Errors Only)</option>
						</select>
					</div>

					<div class="cp-form-group">
						<label class="cp-label" for="st_cache_ttl"><?php esc_html_e( 'Transient Cache Lifetime (Seconds)', 'chat-pilot' ); ?></label>
						<input type="number" id="st_cache_ttl" name="performance[cache_ttl]" class="cp-input-text" min="60" max="864000" value="<?php echo esc_attr( isset( $performance['cache_ttl'] ) ? $performance['cache_ttl'] : 3600 ); ?>">
						<p class="cp-description">
							<?php esc_html_e( 'Controls internal cache TTL for provider models and vector searches.', 'chat-pilot' ); ?>
						</p>
					</div>
				</div>

				<!-- SECTION 7: SECURITY -->
				<div id="cp-st-sec-security" class="cp-settings-section cp-card" style="padding:1.5rem; display:none;">
					<h2 class="cp-card-title" style="margin-bottom:1.25rem;">
						<span>🛡️</span> <?php esc_html_e( 'Security & Access Control', 'chat-pilot' ); ?>
					</h2>

					<div class="cp-form-group" style="margin-bottom:1.25rem;">
						<label class="cp-label" for="st_required_capability"><?php esc_html_e( 'Required WordPress Capability', 'chat-pilot' ); ?></label>
						<select id="st_required_capability" name="security[required_capability]" class="cp-select">
							<option value="manage_options" <?php selected( isset( $security['required_capability'] ) ? $security['required_capability'] : 'manage_options', 'manage_options' ); ?>>manage_options (Administrator Only)</option>
							<option value="edit_theme_options" <?php selected( isset( $security['required_capability'] ) ? $security['required_capability'] : 'manage_options', 'edit_theme_options' ); ?>>edit_theme_options (Editor & Admin)</option>
						</select>
						<p class="cp-description">
							<?php esc_html_e( 'WordPress user capability required to access Chat Pilot admin dashboard.', 'chat-pilot' ); ?>
						</p>
					</div>

					<div class="cp-form-group" style="margin-bottom:1.25rem;">
						<label class="cp-checkbox-label">
							<input type="checkbox" name="security[mask_sensitive_logs]" class="cp-checkbox" value="1" <?php checked( isset( $security['mask_sensitive_logs'] ) ? $security['mask_sensitive_logs'] : true ); ?>>
							<span><?php esc_html_e( 'Mask Sensitive Keys in System Logs', 'chat-pilot' ); ?></span>
						</label>
					</div>

					<div class="cp-form-group">
						<label class="cp-checkbox-label">
							<input type="checkbox" name="security[strict_nonce_verification]" class="cp-checkbox" value="1" <?php checked( isset( $security['strict_nonce_verification'] ) ? $security['strict_nonce_verification'] : true ); ?>>
							<span><?php esc_html_e( 'Enforce Strict Administrative Nonce Verification', 'chat-pilot' ); ?></span>
						</label>
					</div>
				</div>

				<!-- SECTION 8: DEVELOPER MODE -->
				<div id="cp-st-sec-developer" class="cp-settings-section cp-card" style="padding:1.5rem; display:none;">
					<h2 class="cp-card-title" style="margin-bottom:1.25rem;">
						<span>🛠️</span> <?php esc_html_e( 'Developer & Debugging Mode', 'chat-pilot' ); ?>
					</h2>

					<div class="cp-form-group" style="margin-bottom:1.25rem;">
						<label class="cp-checkbox-label">
							<input type="checkbox" name="developer[dev_mode]" class="cp-checkbox" value="1" <?php checked( isset( $developer['dev_mode'] ) ? $developer['dev_mode'] : false ); ?>>
							<span><strong><?php esc_html_e( 'Enable Developer Mode', 'chat-pilot' ); ?></strong></span>
						</label>
						<p class="cp-description">
							<?php esc_html_e( 'Bypasses administrative asset caching and enables developer utility resets.', 'chat-pilot' ); ?>
						</p>
					</div>

					<div class="cp-form-group" style="margin-bottom:1.25rem;">
						<label class="cp-checkbox-label">
							<input type="checkbox" name="developer[debug_mode]" class="cp-checkbox" value="1" <?php checked( isset( $developer['debug_mode'] ) ? $developer['debug_mode'] : false ); ?>>
							<span><?php esc_html_e( 'Enable WP_DEBUG Context Logging', 'chat-pilot' ); ?></span>
						</label>
					</div>

					<div class="cp-form-group">
						<label class="cp-checkbox-label">
							<input type="checkbox" name="developer[unminified_scripts]" class="cp-checkbox" value="1" <?php checked( isset( $developer['unminified_scripts'] ) ? $developer['unminified_scripts'] : false ); ?>>
							<span><?php esc_html_e( 'Load Unminified Scripts and Styles', 'chat-pilot' ); ?></span>
						</label>
					</div>
				</div>

				<!-- SECTION 9: MAINTENANCE & UTILITIES -->
				<div id="cp-st-sec-maintenance" class="cp-settings-section cp-card" style="padding:1.5rem; display:none;">
					<h2 class="cp-card-title" style="margin-bottom:1.25rem; color:#ef4444;">
						<span>🧰</span> <?php esc_html_e( 'Maintenance & System Utilities', 'chat-pilot' ); ?>
					</h2>

					<!-- Diagnostics Overview -->
					<div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); border-radius:8px; padding:1rem; margin-bottom:1.5rem;">
						<h4 style="margin:0 0 0.75rem 0; font-family:'Outfit', sans-serif; font-size:0.95rem; color:#ffffff;">
							<?php esc_html_e( 'System Diagnostics Overview', 'chat-pilot' ); ?>
						</h4>
						<div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap:0.75rem; font-size:0.8rem; color:var(--text-secondary);">
							<div>WordPress: <strong style="color:#ffffff;"><?php echo esc_html( get_bloginfo( 'version' ) ); ?></strong></div>
							<div>PHP Version: <strong style="color:#ffffff;"><?php echo esc_html( PHP_VERSION ); ?></strong></div>
							<div>MySQL Version: <strong style="color:#ffffff;"><?php echo esc_html( $wpdb->db_version() ); ?></strong></div>
							<div>DB Logs Count: <strong style="color:var(--accent-cyan);"><?php echo esc_html( number_format( $logs_count ) ); ?></strong></div>
							<div>Conversations: <strong style="color:#a855f7;"><?php echo esc_html( number_format( $convs_count ) ); ?></strong></div>
							<div>Last Schema Sync: <strong style="color:#ffffff;"><?php echo esc_html( ! empty( $system_info['last_resync_timestamp'] ) ? $system_info['last_resync_timestamp'] : 'Never' ); ?></strong></div>
						</div>
					</div>

					<!-- Safe Maintenance Utilities -->
					<div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap:1rem; margin-bottom:1.5rem;">
						<button type="button" id="cp-btn-clear-logs" class="cp-btn" style="background:rgba(255,255,255,0.06); color:#ffffff; border:1px solid rgba(255,255,255,0.15); justify-content:center;">
							🧹 <?php esc_html_e( 'Clear System Logs', 'chat-pilot' ); ?>
						</button>
						<button type="button" id="cp-btn-clear-cache" class="cp-btn" style="background:rgba(255,255,255,0.06); color:#ffffff; border:1px solid rgba(255,255,255,0.15); justify-content:center;">
							⚡ <?php esc_html_e( 'Clear Transient Cache', 'chat-pilot' ); ?>
						</button>
						<button type="button" id="cp-btn-resync-meta" class="cp-btn" style="background:rgba(255,255,255,0.06); color:#ffffff; border:1px solid rgba(255,255,255,0.15); justify-content:center;">
							🔄 <?php esc_html_e( 'Re-sync Schema & Metadata', 'chat-pilot' ); ?>
						</button>
					</div>

					<!-- Destructive Resets -->
					<div style="border-top:1px solid rgba(239,68,68,0.2); padding-top:1.25rem;">
						<h4 style="margin:0 0 0.5rem 0; font-family:'Outfit', sans-serif; font-size:0.95rem; color:#ef4444;">
							⚠️ <?php esc_html_e( 'Destructive Reset Actions', 'chat-pilot' ); ?>
						</h4>
						<p style="font-size:0.8rem; color:var(--text-muted); margin-bottom:1rem;">
							<?php esc_html_e( 'These actions permanently reset configurations. They do not delete your Knowledge Base documents, Conversations, or Form Submissions records.', 'chat-pilot' ); ?>
						</p>

						<div style="display:flex; gap:1rem; flex-wrap:wrap;">
							<button type="button" id="cp-btn-reset-section" class="cp-btn" style="background:rgba(245,158,11,0.15); color:#f59e0b; border:1px solid rgba(245,158,11,0.3);">
								⚠️ <?php esc_html_e( 'Reset General Settings Section', 'chat-pilot' ); ?>
							</button>
							<button type="button" id="cp-btn-factory-reset" class="cp-btn cp-btn-danger">
								🚨 <?php esc_html_e( 'Full System Factory Reset', 'chat-pilot' ); ?>
							</button>
						</div>
					</div>
				</div>

			</form>
		</div>

	</div>
</div>

<!-- Modal Confirmation Container for Destructive Actions -->
<div id="cp-settings-modal-overlay" style="display:none; position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.75); backdrop-filter:blur(6px); z-index:999999; align-items:center; justify-content:center;">
	<div class="cp-card" style="width:100%; max-width:480px; padding:1.5rem; border-color:#ef4444; box-shadow:0 20px 50px rgba(0,0,0,0.8);">
		<h3 id="cp-modal-title" style="margin:0 0 0.75rem 0; font-family:'Outfit', sans-serif; color:#ef4444; font-size:1.2rem; display:flex; align-items:center; gap:0.5rem;">
			⚠️ <?php esc_html_e( 'Confirm Action', 'chat-pilot' ); ?>
		</h3>
		<p id="cp-modal-body" style="font-size:0.85rem; color:var(--text-secondary); line-height:1.5; margin-bottom:1.25rem;"></p>
		
		<div id="cp-modal-confirm-input-wrap" style="display:none; margin-bottom:1.25rem;">
			<label style="display:block; font-size:0.75rem; color:var(--text-muted); margin-bottom:0.35rem;">Type <strong>YES</strong> to confirm full factory reset:</label>
			<input type="text" id="cp-modal-confirm-input" class="cp-input-text" placeholder="YES" style="text-transform:uppercase; text-align:center; font-weight:700;">
		</div>

		<div style="display:flex; justify-content:flex-end; gap:0.75rem;">
			<button type="button" id="cp-modal-cancel-btn" class="cp-btn" style="background:rgba(255,255,255,0.08); color:#ffffff; border:1px solid rgba(255,255,255,0.15);">
				<?php esc_html_e( 'Cancel', 'chat-pilot' ); ?>
			</button>
			<button type="button" id="cp-modal-action-btn" class="cp-btn cp-btn-danger">
				<?php esc_html_e( 'Proceed', 'chat-pilot' ); ?>
			</button>
		</div>
	</div>
</div>
