<?php
/**
 * Tab AI Providers Configuration Template
 */

// Prevent direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$plugin = \ChatPilot\Core\Plugin::instance();
$available_providers = $plugin->providers->get_available_providers();

$default_provider = $plugin->settings->get( 'default_provider', '' );
$default_model    = $plugin->settings->get( 'default_model', '' );

// Helper function to mask API keys safely at rendering.
if ( ! function_exists( 'chat_pilot_mask_key' ) ) {
	function chat_pilot_mask_key( $key, $slug ) {
		if ( empty( $key ) ) {
			return '';
		}
		$len = strlen( $key );
		if ( 'openai' === $slug ) {
			$prefix = ( $len > 8 ) ? substr( $key, 0, 8 ) : 'sk-proj-';
			return $prefix . str_repeat( '*', max( 8, $len - strlen( $prefix ) ) );
		}
		$prefix = ( $len > 4 ) ? substr( $key, 0, 4 ) : 'api-';
		return $prefix . str_repeat( '*', max( 8, $len - strlen( $prefix ) ) );
	}
}

if ( ! function_exists( 'chat_pilot_format_model_label' ) ) {
	function chat_pilot_format_model_label( $model ) {
		if ( strpos( $model, 'antigravity' ) !== false ) {
			return $model . ' (' . esc_html__( 'Interactions API Only', 'chat-pilot' ) . ')';
		}
		if ( strpos( $model, 'deep-research' ) !== false ) {
			return $model . ' (' . esc_html__( 'Deep Research Only', 'chat-pilot' ) . ')';
		}
		return $model;
	}
}
?>

<div class="cp-dashboard-grid">
	<!-- Main Configuration Area -->
	<div class="cp-grid-main">
		<!-- 1. AI Provider Selector Card -->
		<div class="cp-card">
			<div class="cp-form-group" style="margin: 0;">
				<label class="cp-label" for="selected_provider_tab" style="font-family:'Outfit',sans-serif; font-size:1.05rem; font-weight:700; color:var(--text-primary); margin-bottom: 0.5rem;">
					<?php esc_html_e( 'Select AI Provider Configuration', 'chat-pilot' ); ?>
				</label>
				<select id="selected_provider_tab" class="cp-input-text" style="font-size:0.95rem; height:44px; padding:0 0.85rem; line-height:42px;">
					<option value="openai"><?php esc_html_e( 'OpenAI', 'chat-pilot' ); ?></option>
					<option value="gemini"><?php esc_html_e( 'Google Gemini', 'chat-pilot' ); ?></option>
					<option value="claude" disabled><?php esc_html_e( 'Anthropic Claude (Coming Soon)', 'chat-pilot' ); ?></option>
					<option value="deepseek" disabled><?php esc_html_e( 'DeepSeek (Coming Soon)', 'chat-pilot' ); ?></option>
					<option value="grok" disabled><?php esc_html_e( 'Grok (Coming Soon)', 'chat-pilot' ); ?></option>
					<option value="openrouter" disabled><?php esc_html_e( 'OpenRouter (Coming Soon)', 'chat-pilot' ); ?></option>
					<option value="ollama" disabled><?php esc_html_e( 'Ollama (Coming Soon)', 'chat-pilot' ); ?></option>
					<option value="azure" disabled><?php esc_html_e( 'Azure OpenAI (Coming Soon)', 'chat-pilot' ); ?></option>
				</select>
			</div>
		</div>

		<!-- 2. Global Defaults Configuration Card (Moved to position 2) -->
		<div class="cp-card" id="cp-global-defaults-card">
			<h2 class="cp-card-title">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"></path></svg>
				<?php esc_html_e( 'Global AI engine defaults', 'chat-pilot' ); ?>
			</h2>
			<form id="cp-defaults-form" class="cp-ajax-form">
				<!-- Scenario 1: Single Connected Provider Display Container -->
				<div id="cp-defaults-single" style="display: none; background: rgba(6, 182, 212, 0.02); border: 1px solid rgba(6, 182, 212, 0.1); border-radius: 8px; padding: 1.25rem; margin-bottom: 1.5rem;">
					<div class="cp-form-group" style="margin-bottom: 1rem;">
						<span class="cp-label"><?php esc_html_e( 'Current Default AI Provider', 'chat-pilot' ); ?></span>
						<div id="cp-single-provider-name" style="font-family: 'Outfit', sans-serif; font-size: 1.15rem; font-weight: 700; color: var(--accent-cyan);">—</div>
						<input type="hidden" name="default_provider" id="cp-single-provider-input" value="">
					</div>
					<div class="cp-form-group" style="margin: 0;">
						<span class="cp-label"><?php esc_html_e( 'Current Default Model', 'chat-pilot' ); ?></span>
						<div id="cp-single-model-name" style="font-family: var(--font-mono); font-size: 0.95rem; font-weight: 600; color: var(--text-primary);">—</div>
						<input type="hidden" name="default_model" id="cp-single-model-input" value="">
					</div>
				</div>

				<!-- Scenario 2: Multiple Connected Providers Display Container -->
				<div id="cp-defaults-dropdowns" style="display: none;">
					<div class="cp-form-group">
						<label class="cp-label" for="default_provider"><?php esc_html_e( 'Global Default AI Provider', 'chat-pilot' ); ?></label>
						<select id="default_provider" class="cp-input-text">
							<option value=""><?php esc_html_e( '— Select Default Provider —', 'chat-pilot' ); ?></option>
							<?php foreach ( $available_providers as $slug => $info ) : ?>
								<?php if ( 'connected' === strtolower( $info['status'] ) ) : ?>
									<option value="<?php echo esc_attr( $slug ); ?>" <?php selected( $default_provider, $slug ); ?>>
										<?php echo esc_html( $info['name'] ); ?> (<?php echo esc_html( $info['default_model'] ); ?>)
									</option>
								<?php endif; ?>
							<?php endforeach; ?>
						</select>
						<p class="cp-description">
							<?php esc_html_e( 'Select the primary active AI provider for all frontend widgets.', 'chat-pilot' ); ?>
						</p>
					</div>

					<div class="cp-form-group">
						<label class="cp-label" for="default_model"><?php esc_html_e( 'Global Default Model Override', 'chat-pilot' ); ?></label>
						<select id="default_model" class="cp-input-text" data-selected-value="<?php echo esc_attr( $default_model ); ?>">
							<option value=""><?php esc_html_e( '— Select Default Model —', 'chat-pilot' ); ?></option>
						</select>
						<p class="cp-description">
							<?php esc_html_e( 'Default model override for global prompt tasks.', 'chat-pilot' ); ?>
						</p>
					</div>
				</div>

				<!-- Scenario 3: No Active Providers Fallback Container -->
				<div id="cp-defaults-empty" style="display: block; background: rgba(239, 68, 68, 0.02); border: 1px solid rgba(239, 68, 68, 0.1); border-radius: 8px; padding: 1.25rem; margin-bottom: 1.5rem; color: var(--accent-orange);">
					<?php esc_html_e( 'No active and connected AI providers found. Please configure and connect a provider below.', 'chat-pilot' ); ?>
				</div>

				<button type="submit" class="cp-btn cp-btn-primary" id="cp-defaults-save-btn" style="display: none;">
					<?php esc_html_e( 'Save Changes', 'chat-pilot' ); ?>
				</button>
			</form>
		</div>

		<!-- 3. AI Providers Configurations Panels -->
		<?php foreach ( $available_providers as $slug => $info ) : ?>
			<?php
			// Display OpenAI by default, hide Gemini initially.
			$display_style = ( 'openai' === $slug ) ? 'display: block;' : 'display: none;';
			?>
			<div class="cp-card cp-provider-card" data-slug="<?php echo esc_attr( $slug ); ?>" style="<?php echo esc_attr( $display_style ); ?>">
				<div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(255,255,255,0.05); padding-bottom:1rem; margin-bottom:1.5rem; flex-wrap:wrap; gap:1rem;">
					<div style="display:flex; align-items:center; gap:0.75rem;">
						<div class="provider-logo-placeholder" style="width:32px; height:32px; display:flex; align-items:center; justify-content:center; background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.05); border-radius:6px; font-size:1.2rem;">
							<?php echo 'openai' === $slug ? '⚡' : '✨'; ?>
						</div>
						<div>
							<h3 style="font-family:'Outfit',sans-serif; font-size:1.25rem; font-weight:700; margin:0; color:#ffffff !important; opacity:1 !important;"><?php echo esc_html( $info['name'] ); ?></h3>
							<span style="font-size:0.75rem; color:var(--text-secondary);"><?php echo esc_html( $info['description'] ); ?></span>
						</div>
					</div>

					<div style="display:flex; align-items:center; gap:1rem;">
						<span class="status-badge <?php echo esc_attr( str_replace( ' ', '-', $info['status'] ) ); ?> cp-js-status-badge">
							<?php echo esc_html( $info['status'] ); ?>
						</span>
						<label class="cp-checkbox-label" style="margin:0;">
							<input type="checkbox" name="enabled" class="cp-checkbox cp-js-toggle-provider" value="1" <?php checked( $info['enabled'] ); ?>>
							<span style="font-size:0.85rem; font-weight:600;"><?php esc_html_e( 'Active', 'chat-pilot' ); ?></span>
						</label>
					</div>
				</div>

				<form class="cp-provider-settings-form">
					<input type="hidden" name="provider_slug" value="<?php echo esc_attr( $slug ); ?>">
					<input type="hidden" name="provider[enabled]" value="<?php echo $info['enabled'] ? '1' : '0'; ?>" class="provider-enabled-hidden">

					<!-- API Key -->
					<div class="cp-form-group">
						<label class="cp-label"><?php esc_html_e( 'API Credentials Key', 'chat-pilot' ); ?></label>
						<input type="password" name="provider[api_key]" class="cp-input-text" autocomplete="new-password" value="<?php echo esc_attr( chat_pilot_mask_key( $plugin->settings->get( "providers.{$slug}.api_key", '' ), $slug ) ); ?>" placeholder="••••••••••••••••••••••••••••••••">
					</div>

					<!-- OpenAI Specific Fields -->
					<?php if ( 'openai' === $slug ) : ?>
						<div class="cp-form-group">
							<label class="cp-label"><?php esc_html_e( 'Organization ID (Optional)', 'chat-pilot' ); ?></label>
							<input type="text" name="provider[org_id]" class="cp-input-text" value="<?php echo esc_attr( $plugin->settings->get( 'providers.openai.org_id', '' ) ); ?>">
						</div>
						<div class="cp-form-group">
							<label class="cp-label"><?php esc_html_e( 'Base URL Override (Optional)', 'chat-pilot' ); ?></label>
							<input type="text" name="provider[base_url]" class="cp-input-text" value="<?php echo esc_attr( $plugin->settings->get( 'providers.openai.base_url', 'https://api.openai.com/v1' ) ); ?>">
						</div>
					<?php endif; ?>

					<!-- Default model selection -->
					<div class="cp-form-group">
						<label class="cp-label" style="font-weight:600; color:#ffffff; margin-bottom:0.5rem; display:block;"><?php esc_html_e( 'Preferred Model Default', 'chat-pilot' ); ?></label>
						<select name="provider[default_model]" class="cp-input-text cp-model-select" style="font-size:0.9rem; color:#ffffff; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.15);">
							<?php if ( empty( $info['models'] ) ) : ?>
								<option value=""><?php esc_html_e( '— Run connection test to discover models —', 'chat-pilot' ); ?></option>
							<?php else : ?>
								<option value=""><?php esc_html_e( '— Select Discovered Model —', 'chat-pilot' ); ?></option>
								<?php
								$is_model_found = false;
								foreach ( $info['models'] as $m ) {
									$sel = selected( $info['default_model'], $m, false );
									if ( $sel ) {
										$is_model_found = true;
									}
									echo '<option value="' . esc_attr( $m ) . '" ' . $sel . '>' . esc_html( chat_pilot_format_model_label( $m ) ) . '</option>';
								}
								if ( ! empty( $info['default_model'] ) && ! $is_model_found ) {
									echo '<option value="' . esc_attr( $info['default_model'] ) . '" selected style="color:#ef4444;">[Stale/Invalid Model: ' . esc_html( $info['default_model'] ) . '] — Please re-test connection</option>';
								}
								?>
							<?php endif; ?>
						</select>
					</div>

					<div style="display:flex; gap:1rem; margin-top:2rem; flex-wrap:wrap;">
						<button type="submit" class="cp-btn cp-btn-primary">
							<?php esc_html_e( 'Save Changes', 'chat-pilot' ); ?>
						</button>
						<button type="button" class="cp-btn cp-btn-secondary cp-js-test-connection">
							<?php esc_html_e( 'Test Connection', 'chat-pilot' ); ?>
						</button>
					</div>
				</form>
			</div>
		<?php endforeach; ?>
	</div>

	<!-- Sidebar Operational Diagnostics -->
	<div class="cp-grid-sidebar">
		<!-- 1. Provider Health Monitor -->
		<div class="cp-card">
			<h2 class="cp-card-title">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
				<?php esc_html_e( 'Provider Health Monitor', 'chat-pilot' ); ?>
			</h2>

			<?php foreach ( $available_providers as $slug => $info ) : ?>
				<?php
				// Display OpenAI by default, hide Gemini initially.
				$display_style = ( 'openai' === $slug ) ? 'display: block;' : 'display: none;';
				?>
				<div class="cp-health-block" data-slug="<?php echo esc_attr( $slug ); ?>" style="<?php echo esc_attr( $display_style ); ?>">
					<h4 style="font-family:'Outfit',sans-serif; font-size:0.95rem; font-weight:700; margin-bottom:0.75rem; color:var(--text-primary);">
						<?php echo esc_html( $info['name'] ); ?>
					</h4>
					<ul class="cp-info-list" style="font-size:0.8rem;">
						<li class="cp-info-row">
							<span class="cp-info-label"><?php esc_html_e( 'Status', 'chat-pilot' ); ?></span>
							<span class="cp-info-value status-badge <?php echo esc_attr( str_replace( ' ', '-', $info['status'] ) ); ?> cp-js-health-badge" style="font-size:0.7rem; padding:0.1rem 0.4rem;">
								<?php echo esc_html( $info['status'] ); ?>
							</span>
						</li>
						<li class="cp-info-row">
							<span class="cp-info-label"><?php esc_html_e( 'Latency', 'chat-pilot' ); ?></span>
							<span class="cp-info-value cp-js-health-latency"><?php echo esc_html( $info['response_time'] ); ?> ms</span>
						</li>
						<li class="cp-info-row">
							<span class="cp-info-label"><?php esc_html_e( 'Error Count', 'chat-pilot' ); ?></span>
							<span class="cp-info-value cp-js-health-errors" style="color:<?php echo $info['error_count'] > 0 ? 'var(--accent-red)' : 'inherit'; ?>;"><?php echo esc_html( $info['error_count'] ); ?></span>
						</li>
						<li class="cp-info-row" style="flex-direction:column; align-items:flex-start; gap:0.25rem;">
							<span class="cp-info-label"><?php esc_html_e( 'Last Connection Success', 'chat-pilot' ); ?></span>
							<span class="cp-info-value cp-js-health-success" style="font-size:0.75rem; color:var(--text-muted);"><?php echo esc_html( ! empty( $info['last_success'] ) ? $info['last_success'] : '—' ); ?></span>
						</li>
						<li class="cp-info-row" style="flex-direction:column; align-items:flex-start; gap:0.25rem;">
							<span class="cp-info-label"><?php esc_html_e( 'Last Connection Failure', 'chat-pilot' ); ?></span>
							<span class="cp-info-value cp-js-health-failure" style="font-size:0.75rem; color:var(--text-muted);"><?php echo esc_html( ! empty( $info['last_failure'] ) ? $info['last_failure'] : '—' ); ?></span>
						</li>
					</ul>
				</div>
			<?php endforeach; ?>
		</div>

		<!-- 2. Developer Tools Quick Action Link -->
		<div class="cp-card">
			<h2 class="cp-card-title">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>
				<?php esc_html_e( 'Developer Testing Tools', 'chat-pilot' ); ?>
			</h2>
			<?php
			$initial_playground_url = add_query_arg(
				array(
					'tab'      => 'playground',
					'provider' => 'openai',
				)
			);
			?>
			<a href="<?php echo esc_url( $initial_playground_url ); ?>" id="cp-js-playground-link" class="cp-btn cp-btn-secondary" style="width:100%; justify-content:center; text-decoration:none;">
				<?php esc_html_e( 'Open OpenAI Playground', 'chat-pilot' ); ?>
			</a>
		</div>
	</div>
</div>

<!-- Inject models and current configurations states maps for dynamic JS synchronization binding -->
<script type="text/javascript">
	window.chatPilotProvidersState = {
		<?php foreach ( $available_providers as $slug => $info ) : ?>
			<?php echo esc_js( $slug ); ?>: {
				name: <?php echo wp_json_encode( $info['name'] ); ?>,
				enabled: <?php echo $info['enabled'] ? 'true' : 'false'; ?>,
				status: <?php echo wp_json_encode( $info['status'] ); ?>,
				default_model: <?php echo wp_json_encode( $info['default_model'] ); ?>,
				models: <?php echo wp_json_encode( $info['models'] ); ?>,
				has_key: <?php echo ! empty( $plugin->settings->get( "providers.{$slug}.api_key", '' ) ) ? 'true' : 'false'; ?>
			},
		<?php endforeach; ?>
	};
	window.chatPilotPlaygroundModels = <?php echo wp_json_encode( array_map( function( $p ) { return $p['models']; }, $available_providers ) ); ?>;
</script>
