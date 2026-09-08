<?php
/**
 * Tab Chat Widget Customizer settings template
 */

// Prevent direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$plugin = \ChatPilot\Core\Plugin::instance();

// Retrieve options
$enable_widget       = $plugin->settings->get( 'widget.enable_widget', true );
$position            = $plugin->settings->get( 'widget.position', 'bottom-right' );
$primary_color       = $plugin->settings->get( 'widget.primary_color', '#06b6d4' );
$welcome_message     = $plugin->settings->get( 'widget.welcome_message', 'Hi there! How can I help you today?' );
$placeholder_text    = $plugin->settings->get( 'widget.placeholder_text', 'Ask a question...' );
$suggested_questions = $plugin->settings->get( 'widget.suggested_questions', "What services do you provide?\nWhat areas do you serve?\nDo you offer military discounts?" );
$logo_url            = $plugin->settings->get( 'widget.logo_url', '' );

$collect_name  = $plugin->settings->get( 'widget.collect_name', false );
$collect_email = $plugin->settings->get( 'widget.collect_email', false );
$collect_phone = $plugin->settings->get( 'widget.collect_phone', false );

$enable_typing    = $plugin->settings->get( 'widget.enable_typing', true );
$enable_streaming = $plugin->settings->get( 'widget.enable_streaming', true );
$auto_open_chat   = $plugin->settings->get( 'widget.auto_open_chat', true );
$open_once_per_visitor = $plugin->settings->get( 'widget.open_once_per_visitor', true );
$auto_open_delay  = $plugin->settings->get( 'widget.auto_open_delay', 5 );
?>

<div class="cp-dashboard-grid">
	<!-- Main Panel: Configuration Settings -->
	<div class="cp-grid-main">
		<div class="cp-card">
			<h2 class="cp-card-title">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
				<?php esc_html_e( 'Visitor Widget Customizer', 'chat-pilot' ); ?>
			</h2>

			<form id="cp-widget-settings-form">
				<!-- Enable Widget Switch -->
				<div class="cp-form-group">
					<label class="cp-checkbox-label">
						<input type="checkbox" name="enable_widget" class="cp-checkbox" value="1" <?php checked( $enable_widget ); ?>>
						<span><strong><?php esc_html_e( 'Display Widget on Frontend', 'chat-pilot' ); ?></strong></span>
					</label>
					<p class="cp-description">
						<?php esc_html_e( 'Toggle the visibility of the floating chat bubble on your website frontend.', 'chat-pilot' ); ?>
					</p>
				</div>

				<div style="border-top:1px solid rgba(255,255,255,0.05); margin: 2rem 0; padding-top: 1.5rem;">
					<h3 style="font-family: 'Outfit', sans-serif; font-size:1.1rem; margin-bottom:1.25rem; color:var(--accent-purple);">
						<?php esc_html_e( 'Widget Visual Design', 'chat-pilot' ); ?>
					</h3>

					<div style="display:grid; grid-template-columns:1fr 1fr; gap:1.5rem; margin-bottom:1.5rem;">
						<!-- Widget Position -->
						<div class="cp-form-group" style="margin:0;">
							<label class="cp-label" for="widget_position"><?php esc_html_e( 'Widget Alignment', 'chat-pilot' ); ?></label>
							<select id="widget_position" name="position" class="cp-input">
								<option value="bottom-right" <?php selected( $position, 'bottom-right' ); ?>><?php esc_html_e( 'Bottom Right', 'chat-pilot' ); ?></option>
								<option value="bottom-left" <?php selected( $position, 'bottom-left' ); ?>><?php esc_html_e( 'Bottom Left', 'chat-pilot' ); ?></option>
							</select>
						</div>

						<!-- Primary Accent Color -->
						<div class="cp-form-group" style="margin:0;">
							<label class="cp-label" for="widget_color"><?php esc_html_e( 'Accent Theme Color', 'chat-pilot' ); ?></label>
							<div style="display:flex; gap:0.75rem; align-items:center;">
								<input type="color" id="widget_color_picker" class="cp-input" style="width: 50px; height: 42px; padding: 2px; cursor: pointer; background: transparent; border-radius: 6px;" value="<?php echo esc_attr( $primary_color ); ?>" oninput="document.getElementById('widget_color').value = this.value">
								<input type="text" id="widget_color" name="primary_color" class="cp-input" style="flex-grow:1; text-align:center; font-family: monospace;" value="<?php echo esc_attr( $primary_color ); ?>" oninput="document.getElementById('widget_color_picker').value = this.value">
							</div>
						</div>
					</div>

					<!-- Logo URL -->
					<div class="cp-form-group">
						<label class="cp-label" for="widget_logo"><?php esc_html_e( 'Widget Brand Logo Avatar URL', 'chat-pilot' ); ?></label>
						<input type="text" id="widget_logo" name="logo_url" class="cp-input" value="<?php echo esc_url( $logo_url ); ?>" placeholder="https://example.com/logo.png">
						<p class="cp-description">
							<?php esc_html_e( 'Optionally provide a custom square image URL to display as the widget header profile avatar.', 'chat-pilot' ); ?>
						</p>
					</div>
				</div>

				<div style="border-top:1px solid rgba(255,255,255,0.05); margin: 2rem 0; padding-top: 1.5rem;">
					<h3 style="font-family: 'Outfit', sans-serif; font-size:1.1rem; margin-bottom:1.25rem; color:var(--accent-cyan);">
						<?php esc_html_e( 'Greeting Directives & Suggestions', 'chat-pilot' ); ?>
					</h3>

					<!-- Welcome Message -->
					<div class="cp-form-group">
						<label class="cp-label" for="widget_welcome"><?php esc_html_e( 'Welcome Greeting Message', 'chat-pilot' ); ?></label>
						<textarea id="widget_welcome" name="welcome_message" class="cp-input" style="height: 80px; resize: vertical;" placeholder="<?php esc_attr_e( 'Write welcome message...', 'chat-pilot' ); ?>"><?php echo esc_textarea( $welcome_message ); ?></textarea>
					</div>

					<!-- Placeholder Text -->
					<div class="cp-form-group">
						<label class="cp-label" for="widget_placeholder"><?php esc_html_e( 'Input Field Placeholder Text', 'chat-pilot' ); ?></label>
						<input type="text" id="widget_placeholder" name="placeholder_text" class="cp-input" value="<?php echo esc_attr( $placeholder_text ); ?>">
					</div>

					<!-- Suggested Starter Questions -->
					<div class="cp-form-group">
						<label class="cp-label" for="widget_suggestions"><?php esc_html_e( 'Suggested Starter Questions', 'chat-pilot' ); ?></label>
						<textarea id="widget_suggestions" name="suggested_questions" class="cp-input" style="height: 110px; resize: vertical; font-family: monospace; font-size: 0.9rem;" placeholder="<?php esc_attr_e( 'Enter one suggested question per line...', 'chat-pilot' ); ?>"><?php echo esc_textarea( $suggested_questions ); ?></textarea>
						<p class="cp-description">
							<?php esc_html_e( 'Configure up to 4 suggested questions that appear as quick-click helper bubbles on load. Add one question per line.', 'chat-pilot' ); ?>
						</p>
					</div>
				</div>

				<div style="border-top:1px solid rgba(255,255,255,0.05); margin: 2rem 0; padding-top: 1.5rem;">
					<h3 style="font-family: 'Outfit', sans-serif; font-size:1.1rem; margin-bottom:1.25rem; color:var(--accent-orange);">
						<?php esc_html_e( 'Pre-chat Lead Information Collection', 'chat-pilot' ); ?>
					</h3>

					<div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:1.5rem;">
						<!-- Collect Name -->
						<div class="cp-form-group">
							<label class="cp-checkbox-label">
								<input type="checkbox" name="collect_name" class="cp-checkbox" value="1" <?php checked( $collect_name ); ?>>
								<span><?php esc_html_e( 'Require Name', 'chat-pilot' ); ?></span>
							</label>
						</div>

						<!-- Collect Email -->
						<div class="cp-form-group">
							<label class="cp-checkbox-label">
								<input type="checkbox" name="collect_email" class="cp-checkbox" value="1" <?php checked( $collect_email ); ?>>
								<span><?php esc_html_e( 'Require Email', 'chat-pilot' ); ?></span>
							</label>
						</div>

						<!-- Collect Phone -->
						<div class="cp-form-group">
							<label class="cp-checkbox-label">
								<input type="checkbox" name="collect_phone" class="cp-checkbox" value="1" <?php checked( $collect_phone ); ?>>
								<span><?php esc_html_e( 'Require Phone', 'chat-pilot' ); ?></span>
							</label>
						</div>
					</div>
					<p class="cp-description" style="margin-top: 0.5rem;">
						<?php esc_html_e( 'Enable pre-chat fields to prompt website visitors for name, email, or phone information before starting conversations.', 'chat-pilot' ); ?>
					</p>
				</div>

				<div style="border-top:1px solid rgba(255,255,255,0.05); margin: 2rem 0; padding-top: 1.5rem;">
					<h3 style="font-family: 'Outfit', sans-serif; font-size:1.1rem; margin-bottom:1.25rem; color:var(--accent-green);">
						<?php esc_html_e( 'Conversational Engine Behaviors', 'chat-pilot' ); ?>
					</h3>

					<div style="display:grid; grid-template-columns:1fr 1fr; gap:1.5rem; margin-bottom:1.5rem;">
						<!-- Enable Typing Indicators -->
						<div class="cp-form-group" style="margin:0;">
							<label class="cp-checkbox-label">
								<input type="checkbox" name="enable_typing" class="cp-checkbox" value="1" <?php checked( $enable_typing ); ?>>
								<span><?php esc_html_e( 'Enable Typing Animation', 'chat-pilot' ); ?></span>
							</label>
							<p class="cp-description">
								<?php esc_html_e( 'Display three bouncing typing dots inside message bubble when bot is processing queries.', 'chat-pilot' ); ?>
							</p>
						</div>

						<!-- Enable Streaming -->
						<div class="cp-form-group" style="margin:0;">
							<label class="cp-checkbox-label">
								<input type="checkbox" name="enable_streaming" class="cp-checkbox" value="1" <?php checked( $enable_streaming ); ?>>
								<span><?php esc_html_e( 'Enable Character Streaming', 'chat-pilot' ); ?></span>
							</label>
							<p class="cp-description">
								<?php esc_html_e( 'Streams text responses character-by-character for organic simulated typing interaction.', 'chat-pilot' ); ?>
							</p>
						</div>
					</div>

					<!-- Auto Open Toggle Switch -->
					<div class="cp-form-group">
						<label class="cp-checkbox-label">
							<input type="checkbox" id="widget_auto_open_chat" name="auto_open_chat" class="cp-checkbox" value="1" <?php checked( $auto_open_chat ); ?>>
							<span><strong><?php esc_html_e( 'Auto Open Chat', 'chat-pilot' ); ?></strong></span>
						</label>
						<p class="cp-description">
							<?php esc_html_e( 'Automatically expand the chatbot after the configured delay.', 'chat-pilot' ); ?>
						</p>
					</div>

					<!-- Auto Open Delay -->
					<div class="cp-form-group" id="widget_delay_group" style="<?php echo $auto_open_chat ? '' : 'display:none;'; ?>">
						<label class="cp-label" for="widget_delay"><?php esc_html_e( 'Auto Open Window Delay (Seconds)', 'chat-pilot' ); ?></label>
						<input type="number" id="widget_delay" name="auto_open_delay" class="cp-input" style="width: 120px;" min="0" max="60" value="<?php echo esc_attr( $auto_open_delay ); ?>">
						<p class="cp-description">
							<?php esc_html_e( 'Delay in seconds before the chatbot expands automatically.', 'chat-pilot' ); ?>
						</p>
					</div>

					<!-- Open Only Once per Visitor Toggle Switch -->
					<div class="cp-form-group" id="widget_once_group" style="<?php echo $auto_open_chat ? '' : 'display:none;'; ?>">
						<label class="cp-checkbox-label">
							<input type="checkbox" id="widget_open_once_per_visitor" name="open_once_per_visitor" class="cp-checkbox" value="1" <?php checked( $open_once_per_visitor ); ?>>
							<span><strong><?php esc_html_e( 'Open Only Once Per Visitor', 'chat-pilot' ); ?></strong></span>
						</label>
						<p class="cp-description">
							<?php esc_html_e( 'Prevent the chatbot from automatically opening repeatedly for the same visitor.', 'chat-pilot' ); ?>
						</p>
					</div>
				</div>

				<div style="margin-top:2.5rem;">
					<button type="submit" class="cp-btn cp-btn-primary">
						<?php esc_html_e( 'Save Widget Layout', 'chat-pilot' ); ?>
					</button>
				</div>
			</form>
		</div>
	</div>

	<!-- Sidebar Help Card -->
	<div class="cp-grid-sidebar">
		<div class="cp-card">
			<h3 class="cp-card-title" style="color:var(--accent-purple);">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
				<?php esc_html_e( 'Design Tips', 'chat-pilot' ); ?>
			</h3>
			<ul class="cp-sidebar-info-card" style="font-size:0.85rem; padding:0; border:none; background:transparent;">
				<li style="margin-bottom:1rem; list-style:none;">
					<strong style="color:var(--accent-cyan); display:block; margin-bottom:0.25rem;"><?php esc_html_e( 'Branding Identity', 'chat-pilot' ); ?></strong>
					<span style="color:var(--text-secondary); line-height:1.5;"><?php esc_html_e( 'Ensure your Display Name matches your business logo avatar for a polished branding layout.', 'chat-pilot' ); ?></span>
				</li>
				<li style="margin-bottom:0; list-style:none;">
					<strong style="color:var(--accent-cyan); display:block; margin-bottom:0.25rem;"><?php esc_html_e( 'Lead Capture', 'chat-pilot' ); ?></strong>
					<span style="color:var(--text-secondary); line-height:1.5;"><?php esc_html_e( 'Require name and email to collect customer leads before the assistant starts answering.', 'chat-pilot' ); ?></span>
				</li>
			</ul>
		</div>
	</div>
</div>
