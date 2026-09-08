<?php
/**
 * Tab AI Instructions settings interface template.
 */

// Prevent direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$plugin = \ChatPilot\Core\Plugin::instance();
$available_providers = $plugin->providers->get_available_providers();

$default_provider = $plugin->settings->get( 'default_provider', $plugin->settings->get( 'ai_defaults.default_provider', 'gemini' ) );
$default_model    = $plugin->settings->get( 'default_model', $plugin->settings->get( 'ai_defaults.default_model', $plugin->settings->get( "providers.{$default_provider}.default_model", 'gemini-3.6-flash' ) ) );
$system_prompt    = $plugin->settings->get( 'ai_instructions.system_prompt', '' );

$fallback_response = $plugin->settings->get( 'ai_instructions.fallback_response', '' );
if ( empty( $fallback_response ) ) {
	$fallback_response = $plugin->settings->get( 'fallback_response', '' );
}
if ( empty( $fallback_response ) ) {
	$fallback_response = $plugin->settings->get( 'kb.fallback_message', '' );
}
if ( empty( $fallback_response ) ) {
	$fallback_response = "I'm sorry, but I couldn't find that information in the available knowledge. Please contact our team for assistance.";
}

if ( ! function_exists( 'chat_pilot_format_model_name' ) ) {
	function chat_pilot_format_model_name( $model ) {
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

<script type="text/javascript">
	window.chatPilotInstructionsModels = {
		<?php foreach ( $available_providers as $slug => $info ) : ?>
			<?php echo esc_js( $slug ); ?>: <?php echo wp_json_encode( isset( $info['models'] ) ? $info['models'] : array() ); ?>,
		<?php endforeach; ?>
	};
	window.chatPilotInstructionsSelectedModel = <?php echo wp_json_encode( $default_model ); ?>;
</script>

<div class="cp-dashboard-grid">
	<!-- Left Main Panel: AI Directives Form -->
	<div class="cp-grid-main">
		<div class="cp-card">
			<h2 class="cp-card-title">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
				<?php esc_html_e( 'AI Agent Directives & Tone Control', 'chat-pilot' ); ?>
			</h2>

			<form id="cp-instructions-form">
				<!-- Default Provider and Model Selection Grid -->
				<div style="display:grid; grid-template-columns:1fr 1fr; gap:1.5rem; margin-bottom:1.5rem;">
					<!-- Provider select -->
					<div class="cp-form-group" style="margin:0;">
						<label class="cp-label" for="instructions_provider"><?php esc_html_e( 'Active AI Provider', 'chat-pilot' ); ?></label>
						<select id="instructions_provider" name="default_provider" class="cp-input">
							<option value=""><?php esc_html_e( '— Select Active Provider —', 'chat-pilot' ); ?></option>
							<?php foreach ( $available_providers as $slug => $info ) : ?>
								<?php if ( $info['enabled'] && 'connected' === strtolower( $info['status'] ) ) : ?>
									<option value="<?php echo esc_attr($slug); ?>" <?php selected( $default_provider, $slug ); ?>>
										<?php echo esc_html( $info['name'] ); ?>
									</option>
								<?php endif; ?>
							<?php endforeach; ?>
						</select>
						<p class="cp-description" style="margin-top:0.35rem; font-size:0.75rem;">
							<?php esc_html_e( 'Choose the primary LLM provider. Must be connected under AI Providers.', 'chat-pilot' ); ?>
						</p>
					</div>

					<!-- Model select -->
					<div class="cp-form-group" style="margin:0;">
						<label class="cp-label" for="instructions_model"><?php esc_html_e( 'Active AI Model', 'chat-pilot' ); ?></label>
						<select id="instructions_model" name="default_model" class="cp-input" disabled>
							<option value=""><?php esc_html_e( '— Select a Provider First —', 'chat-pilot' ); ?></option>
						</select>
						<p class="cp-description" style="margin-top:0.35rem; font-size:0.75rem;">
							<?php esc_html_e( 'Select the specific model version to handle chat sessions.', 'chat-pilot' ); ?>
						</p>
					</div>
				</div>

				<!-- System Prompt / Agent Guidelines -->
				<div class="cp-form-group">
					<label class="cp-label" for="instructions_system_prompt"><?php esc_html_e( 'System / Business Instructions', 'chat-pilot' ); ?></label>
					<textarea id="instructions_system_prompt" name="system_prompt" class="cp-input" style="height: 220px; resize: vertical; font-family: inherit; font-size: 0.95rem; line-height: 1.6;" placeholder="<?php esc_attr_e( 'Write custom directives to guide your AI assistant\'s behavior and tone...', 'chat-pilot' ); ?>"><?php echo esc_textarea( wp_unslash( $system_prompt ) ); ?></textarea>
					<p class="cp-description">
						<?php esc_html_e( 'These instructions define the identity, rules, boundaries, and tone of your AI. Explicitly tell the AI how to behave (e.g., "Do not hallucinate, respond professionally, use bullet points for lists").', 'chat-pilot' ); ?>
					</p>
				</div>

				<!-- Fallback / Missing Knowledge Response -->
				<div class="cp-form-group">
					<label class="cp-label" for="instructions_fallback"><?php esc_html_e( 'Missing Knowledge Fallback Response', 'chat-pilot' ); ?></label>
					<input type="text" id="instructions_fallback" name="fallback_response" class="cp-input" value="<?php echo esc_attr( wp_unslash( $fallback_response ) ); ?>" placeholder="<?php esc_attr_e( 'Write the response when no matching information is found...', 'chat-pilot' ); ?>">
					<p class="cp-description">
						<?php esc_html_e( 'This message is returned to visitors when the search query returns zero matching knowledge documents above the confidence threshold.', 'chat-pilot' ); ?>
					</p>
				</div>

				<div style="margin-top:2.5rem;">
					<button type="submit" class="cp-btn cp-btn-primary">
						<?php esc_html_e( 'Save Agent Directives', 'chat-pilot' ); ?>
					</button>
				</div>
			</form>
		</div>
	</div>

	<!-- Right Sidebar: Configuration Tips -->
	<div class="cp-grid-sidebar">
		<div class="cp-card">
			<h3 class="cp-card-title" style="color:var(--accent-purple);">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
				<?php esc_html_e( 'Prompt Best Practices', 'chat-pilot' ); ?>
			</h3>
			<ul class="cp-sidebar-info-card" style="font-size:0.85rem; padding:0; border:none; background:transparent;">
				<li style="margin-bottom:1rem; list-style:none;">
					<strong style="color:var(--accent-cyan); font-size:0.85rem; display:block; margin-bottom:0.25rem;"><?php esc_html_e( 'Be Direct and Specific', 'chat-pilot' ); ?></strong>
					<span style="color:var(--text-secondary); line-height:1.5;"><?php esc_html_e( 'Instruct the AI exactly on what its job is: "You are the support agent for DumpKing Dumpsters."', 'chat-pilot' ); ?></span>
				</li>
				<li style="margin-bottom:1rem; list-style:none;">
					<strong style="color:var(--accent-cyan); font-size:0.85rem; display:block; margin-bottom:0.25rem;"><?php esc_html_e( 'Prevent Hallucinations', 'chat-pilot' ); ?></strong>
					<span style="color:var(--text-secondary); line-height:1.5;"><?php esc_html_e( 'Instruct the AI: "If the retrieved context does not contain the answer, you must output the fallback response. Do not invent services or prices."', 'chat-pilot' ); ?></span>
				</li>
				<li style="margin-bottom:0; list-style:none;">
					<strong style="color:var(--accent-cyan); font-size:0.85rem; display:block; margin-bottom:0.25rem;"><?php esc_html_e( 'Response Tones', 'chat-pilot' ); ?></strong>
					<span style="color:var(--text-secondary); line-height:1.5;"><?php esc_html_e( 'Define formatting instructions: "Keep answers under 3 sentences, use a friendly yet professional tone, and use bullet points where helpful."', 'chat-pilot' ); ?></span>
				</li>
			</ul>
		</div>
	</div>
</div>

<!-- Inject models lists configuration mapping -->
<script type="text/javascript">
	window.chatPilotInstructionsModels = <?php echo wp_json_encode( array_map( function( $p ) { return $p['models']; }, $available_providers ) ); ?>;
	window.chatPilotInstructionsSelectedModel = <?php echo wp_json_encode( $default_model ); ?>;
</script>
