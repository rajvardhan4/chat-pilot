<?php
namespace ChatPilot\Core;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class Frontend
 * Renders the visitor-facing chat widget.
 *
 * The markup, the CSS class names and the DOM ids are unchanged from v1 - the
 * widget a visitor sees is the same widget, deliberately. What changed is where
 * the values come from: v1 read local WordPress options, v2 reads the cached
 * configuration published by Chat Pilot Cloud.
 *
 * Nothing secret is localised into the page. The Site API Key stays on the
 * server; the browser only ever talks to admin-ajax.php, which proxies to the
 * SaaS (see Admin\Ajax).
 */
class Frontend {

	/**
	 * Cached config for this request.
	 *
	 * @var array|null
	 */
	private $config = null;

	/**
	 * Hooks into the frontend lifecycle.
	 */
	public function __construct() {
		add_action( 'wp_enqueue_scripts', array( $this, 'enqueue_frontend_assets' ) );
		add_action( 'wp_footer', array( $this, 'render_chat_widget' ) );
	}

	/**
	 * Decides whether the widget should render on this request.
	 *
	 * @return bool
	 */
	private function should_render() {
		$plugin = Plugin::instance();

		if ( ! $plugin->settings->get( 'general.enable_plugin', true ) ) {
			return false;
		}
		if ( is_admin() || is_feed() || is_robots() ) {
			return false;
		}
		if ( ! \ChatPilot\Api\Connection::get_api_key() ) {
			return false;
		}
		if ( $plugin->settings->get( 'display.hide_for_admins', false ) && current_user_can( 'manage_options' ) ) {
			return false;
		}
		if ( ! $this->passes_display_rules() ) {
			return false;
		}

		$config = $this->config();
		if ( empty( $config['widget'] ) || empty( $config['widget']['enabled'] ) ) {
			return false;
		}

		/**
		 * Final say for theme and plugin authors.
		 *
		 * @param bool $render Whether to render the widget.
		 */
		return (bool) apply_filters( 'chat_pilot_render_widget', true );
	}

	/**
	 * Applies the include/exclude page rules.
	 *
	 * @return bool
	 */
	private function passes_display_rules() {
		$plugin = Plugin::instance();
		$mode   = $plugin->settings->get( 'display.mode', 'all' );

		if ( 'all' === $mode ) {
			return true;
		}

		$raw   = (string) $plugin->settings->get( 'display.rules', '' );
		$rules = array_filter( array_map( 'trim', explode( ',', $raw ) ) );
		if ( empty( $rules ) ) {
			return 'exclude' === $mode;
		}

		$post_id = get_queried_object_id();
		$path    = trim( wp_parse_url( add_query_arg( array() ), PHP_URL_PATH ), '/' );

		$matched = false;
		foreach ( $rules as $rule ) {
			if ( is_numeric( $rule ) && (int) $rule === (int) $post_id ) {
				$matched = true;
				break;
			}
			if ( ! is_numeric( $rule ) && trim( $rule, '/' ) === $path ) {
				$matched = true;
				break;
			}
		}

		return 'include' === $mode ? $matched : ! $matched;
	}

	/**
	 * Loads (and memoises) the widget configuration.
	 *
	 * @return array|null
	 */
	private function config() {
		if ( null === $this->config ) {
			$this->config = \ChatPilot\Api\ConfigCache::get();
		}
		return $this->config;
	}

	/**
	 * Enqueues widget CSS and JS and localises the safe configuration.
	 */
	public function enqueue_frontend_assets() {
		if ( ! $this->should_render() ) {
			return;
		}

		$plugin  = Plugin::instance();
		$config  = $this->config();
		$widget  = $config['widget'];
		$version = CHAT_PILOT_VERSION;

		if ( $plugin->settings->get( 'developer.dev_mode', false ) ) {
			$version .= '.' . time();
		}

		wp_enqueue_style(
			'chat-pilot-widget-css',
			CHAT_PILOT_URL . 'assets/css/widget-style.css',
			array(),
			$version,
			'all'
		);

		wp_enqueue_script(
			'chat-pilot-widget-js',
			CHAT_PILOT_URL . 'assets/js/widget-script.js',
			array( 'jquery' ),
			$version,
			true
		);

		$prechat = isset( $widget['prechat'] ) ? $widget['prechat'] : array();
		$fields  = array();

		if ( ! empty( $prechat['enabled'] ) && ! empty( $prechat['fields'] ) ) {
			foreach ( $prechat['fields'] as $field ) {
				$fields[] = array(
					'id'          => isset( $field['key'] ) ? sanitize_key( $field['key'] ) : '',
					'type'        => isset( $field['type'] ) ? sanitize_key( $field['type'] ) : 'text',
					'label'       => isset( $field['label'] ) ? sanitize_text_field( $field['label'] ) : '',
					'placeholder' => isset( $field['placeholder'] ) ? sanitize_text_field( $field['placeholder'] ) : '',
					'required'    => ! empty( $field['required'] ),
				);
			}
		}

		$messages = isset( $config['messages'] ) ? $config['messages'] : array();

		wp_localize_script(
			'chat-pilot-widget-js',
			'chatPilotWidget',
			array(
				'ajaxUrl'            => admin_url( 'admin-ajax.php' ),
				'securityNonce'      => wp_create_nonce( 'chat_pilot_widget_nonce' ),
				'position'           => isset( $widget['position'] ) ? sanitize_key( $widget['position'] ) : 'bottom-right',
				'primaryColor'       => isset( $widget['primaryColor'] ) ? sanitize_hex_color( $widget['primaryColor'] ) : '#06b6d4',
				'iconColor'          => isset( $widget['iconColor'] ) ? sanitize_hex_color( $widget['iconColor'] ) : '#ffffff',
				'avatarType'         => isset( $widget['avatarType'] ) ? sanitize_key( $widget['avatarType'] ) : 'pilot',
				'launcherIconType'   => isset( $widget['launcherIconType'] ) ? sanitize_key( $widget['launcherIconType'] ) : 'bubble',
				'welcomeMessage'     => isset( $widget['welcomeMessage'] ) ? sanitize_text_field( $widget['welcomeMessage'] ) : '',
				'placeholderText'    => isset( $widget['placeholderText'] ) ? sanitize_text_field( $widget['placeholderText'] ) : '',
				'suggestedQuestions' => isset( $widget['suggestedQuestions'] ) ? array_map( 'sanitize_text_field', (array) $widget['suggestedQuestions'] ) : array(),
				'hasPrechat'         => ! empty( $prechat['enabled'] ) && ! empty( $fields ),
				'formId'             => isset( $prechat['formId'] ) ? sanitize_text_field( $prechat['formId'] ) : '',
				'formFields'         => $fields,
				'enableTyping'       => ! empty( $widget['enableTyping'] ),
				'enableStreaming'    => ! empty( $widget['enableStreaming'] ),
				'autoOpenChat'       => ! empty( $widget['autoOpenChat'] ),
				'openOncePerVisitor' => ! empty( $widget['openOncePerVisitor'] ),
				'autoOpenDelay'      => isset( $widget['autoOpenDelay'] ) ? (int) $widget['autoOpenDelay'] : 5,
				'logoUrl'            => isset( $widget['logoUrl'] ) ? esc_url_raw( $widget['logoUrl'] ) : '',
				'pluginName'             => isset( $widget['displayName'] ) ? sanitize_text_field( $widget['displayName'] ) : 'Chat Pilot',
				'launcherCalloutEnabled' => ! empty( $widget['launcherCalloutEnabled'] ) || ( ! isset( $widget['launcherCalloutEnabled'] ) ),
				'launcherCalloutText'    => ! empty( $widget['launcherCalloutText'] ) ? sanitize_text_field( $widget['launcherCalloutText'] ) : __( 'Ask any question 👋', 'chat-pilot' ),
				'launcherCalloutBg'      => ! empty( $widget['launcherCalloutBg'] ) ? sanitize_hex_color( $widget['launcherCalloutBg'] ) : '#16213a',
				'launcherCalloutColor'   => ! empty( $widget['launcherCalloutColor'] ) ? sanitize_hex_color( $widget['launcherCalloutColor'] ) : '#ffffff',
				// Visitor-safe copy only. The system prompt never leaves the SaaS.
				'errorMessage'           => isset( $messages['generation_error'] )
					? sanitize_text_field( $messages['generation_error'] )
					: __( "I'm having trouble generating a response right now. Please try again in a moment.", 'chat-pilot' ),
			)
		);
	}

	/**
	 * Renders the widget markup in the footer.
	 *
	 * The structure below is byte-for-byte the v1 layout so existing CSS, theme
	 * overrides and muscle memory all still apply.
	 */
	public function render_chat_widget() {
		if ( ! $this->should_render() ) {
			return;
		}

		$config  = $this->config();
		$widget  = $config['widget'];
		$prechat = isset( $widget['prechat'] ) ? $widget['prechat'] : array();

		$plugin_name        = isset( $widget['displayName'] ) ? $widget['displayName'] : 'Chat Pilot';
		$position           = isset( $widget['position'] ) ? $widget['position'] : 'bottom-right';
		$primary_color      = isset( $widget['primaryColor'] ) ? $widget['primaryColor'] : '#06b6d4';
		$icon_color         = isset( $widget['iconColor'] ) ? $widget['iconColor'] : '#ffffff';
		$avatar_type        = isset( $widget['avatarType'] ) ? sanitize_key( $widget['avatarType'] ) : 'pilot';
		$launcher_icon_type = isset( $widget['launcherIconType'] ) ? sanitize_key( $widget['launcherIconType'] ) : 'bubble';
		$welcome_message    = isset( $widget['welcomeMessage'] ) ? $widget['welcomeMessage'] : '';
		$placeholder_text   = isset( $widget['placeholderText'] ) ? $widget['placeholderText'] : '';
		$logo_url           = isset( $widget['logoUrl'] ) ? $widget['logoUrl'] : '';
		$suggested          = isset( $widget['suggestedQuestions'] ) ? (array) $widget['suggestedQuestions'] : array();

		$callout_enabled    = ! empty( $widget['launcherCalloutEnabled'] ) || ( ! isset( $widget['launcherCalloutEnabled'] ) );
		$callout_text       = ! empty( $widget['launcherCalloutText'] ) ? $widget['launcherCalloutText'] : __( 'Ask any question 👋', 'chat-pilot' );
		$callout_bg         = ! empty( $widget['launcherCalloutBg'] ) ? sanitize_hex_color( $widget['launcherCalloutBg'] ) : '';
		if ( empty( $callout_bg ) ) {
			$callout_bg = '#16213a';
		}
		$callout_color      = ! empty( $widget['launcherCalloutColor'] ) ? sanitize_hex_color( $widget['launcherCalloutColor'] ) : '';
		if ( empty( $callout_color ) ) {
			$callout_color = '#ffffff';
		}

		// Fallback to local plugin SVG avatar if logo_url is empty and a known preset is selected
		if ( empty( $logo_url ) && in_array( $avatar_type, array( 'pilot', 'female', 'male', 'robot', 'sparkle' ), true ) ) {
			$logo_url = CHAT_PILOT_URL . 'assets/img/avatars/avatar-' . $avatar_type . '.svg';
		}

		$has_prechat = ! empty( $prechat['enabled'] ) && ! empty( $prechat['fields'] );
		$form_id     = $has_prechat && isset( $prechat['formId'] ) ? $prechat['formId'] : '';
		$intro       = $has_prechat && ! empty( $prechat['intro'] )
			? $prechat['intro']
			: __( 'Please introduce yourself to start the conversation.', 'chat-pilot' );
		?>
		<div id="chat-pilot-widget-container" class="cp-widget-position-<?php echo esc_attr( $position ); ?>" style="--cp-primary-color: <?php echo esc_attr( $primary_color ); ?>; --cp-icon-color: <?php echo esc_attr( $icon_color ); ?>; --cp-callout-bg: <?php echo esc_attr( $callout_bg ); ?>; --cp-callout-color: <?php echo esc_attr( $callout_color ); ?>;">
			<!-- Launcher Callout Badge -->
			<?php if ( $callout_enabled ) : ?>
				<div id="chat-pilot-launcher-callout" class="cp-launcher-callout" role="button" aria-label="<?php echo esc_attr( $callout_text ); ?>" style="--cp-callout-bg: <?php echo esc_attr( $callout_bg ); ?>; --cp-callout-color: <?php echo esc_attr( $callout_color ); ?>;">
					<span class="cp-callout-pulse-dot"></span>
					<span class="cp-callout-text"><?php echo esc_html( $callout_text ); ?></span>
					<button type="button" id="chat-pilot-callout-close" aria-label="<?php esc_attr_e( 'Dismiss callout', 'chat-pilot' ); ?>">&times;</button>
				</div>
			<?php endif; ?>

			<!-- Launcher Button -->
			<button id="chat-pilot-widget-launcher" aria-label="<?php esc_attr_e( 'Open Chat', 'chat-pilot' ); ?>" class="cp-launcher-type-<?php echo esc_attr( $launcher_icon_type ); ?>">
				<?php if ( 'avatar' === $launcher_icon_type && ! empty( $logo_url ) ) : ?>
					<img src="<?php echo esc_url( $logo_url ); ?>" alt="<?php esc_attr_e( 'Chat Avatar', 'chat-pilot' ); ?>" class="cp-launcher-avatar-img cp-launcher-icon-open">
				<?php else : ?>
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="cp-launcher-icon-open"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
				<?php endif; ?>
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="cp-launcher-icon-close" style="display:none;"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
			</button>

			<!-- Chat Window -->
			<div id="chat-pilot-widget-box" style="display: none;">
				<!-- Header -->
				<div class="cp-widget-header">
					<div class="cp-widget-brand">
						<div class="cp-widget-avatar-wrap">
							<?php if ( ! empty( $logo_url ) ) : ?>
								<img src="<?php echo esc_url( $logo_url ); ?>" alt="<?php esc_attr_e( 'Logo', 'chat-pilot' ); ?>" class="cp-widget-logo">
							<?php else : ?>
								<div class="cp-widget-logo-placeholder">&#129302;</div>
							<?php endif; ?>
							<span class="cp-status-dot-pulse" title="<?php esc_attr_e( 'Online', 'chat-pilot' ); ?>"></span>
						</div>
						<div class="cp-widget-brand-text">
							<h3 class="cp-widget-title"><?php echo esc_html( $plugin_name ); ?></h3>
							<span class="cp-widget-subtitle">
								<span class="cp-subtitle-badge">✦ <?php esc_html_e( 'AI Assistant', 'chat-pilot' ); ?></span>
							</span>
						</div>
					</div>
					<button id="chat-pilot-widget-close" aria-label="<?php esc_attr_e( 'Close Chat', 'chat-pilot' ); ?>">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
					</button>
				</div>

				<!-- Chat Area -->
				<div class="cp-widget-body">
					<?php if ( ! empty( $prechat['fields'] ) ) : ?>
						<div id="cp-widget-prechat-form" data-form-id="<?php echo esc_attr( $form_id ); ?>" style="<?php echo $has_prechat ? '' : 'display: none;'; ?>">
							<div class="cp-widget-prechat-intro-card">
								<span class="cp-intro-icon">👋</span>
								<p class="cp-widget-prechat-intro"><?php echo esc_html( $intro ); ?></p>
							</div>
							<div class="cp-prechat-error-msg" style="display:none; color:#ef4444; font-size:0.85rem; margin-bottom:0.75rem; border:1px solid rgba(239,68,68,0.25); background:rgba(239,68,68,0.1); padding:0.6rem 0.85rem; border-radius:8px; line-height:1.4;"></div>
							<?php foreach ( $prechat['fields'] as $field ) : ?>
								<?php
								$fid           = isset( $field['key'] ) ? sanitize_key( $field['key'] ) : '';
								$ftype         = isset( $field['type'] ) ? sanitize_key( $field['type'] ) : 'text';
								$label         = isset( $field['label'] ) ? $field['label'] : '';
								$placeholder   = isset( $field['placeholder'] ) ? $field['placeholder'] : '';
								$required      = ! empty( $field['required'] );
								$options       = isset( $field['options'] ) ? (array) $field['options'] : array();
								$required_attr = $required ? 'required' : '';
								if ( ! $fid ) {
									continue;
								}
								?>
								<?php if ( 'checkbox' === $ftype ) : ?>
									<div class="cp-widget-form-group cp-widget-form-checkbox" style="display:flex; align-items:center; gap:0.5rem; margin-bottom:0.75rem;">
										<input type="checkbox" id="cp-prechat-<?php echo esc_attr( $fid ); ?>" class="cp-prechat-input-field" value="1" <?php echo esc_attr( $required_attr ); ?> style="margin:0; width:16px; height:16px; cursor:pointer;">
										<label for="cp-prechat-<?php echo esc_attr( $fid ); ?>" style="margin:0; cursor:pointer; font-weight:normal; font-size:0.85rem;">
											<?php echo esc_html( $label ); ?><?php if ( $required ) : ?> <span class="cp-required-star" style="color:#ef4444;">*</span><?php endif; ?>
										</label>
									</div>
								<?php else : ?>
									<div class="cp-widget-form-group" style="margin-bottom:0.75rem;">
										<label for="cp-prechat-<?php echo esc_attr( $fid ); ?>" style="display:block; font-size:0.85rem; font-weight:600; margin-bottom:0.25rem;">
											<?php echo esc_html( $label ); ?><?php if ( $required ) : ?> <span class="cp-required-star" style="color:#ef4444;">*</span><?php endif; ?>
										</label>

										<?php if ( 'textarea' === $ftype ) : ?>
											<textarea id="cp-prechat-<?php echo esc_attr( $fid ); ?>" class="cp-widget-input cp-prechat-input-field" placeholder="<?php echo esc_attr( $placeholder ); ?>" <?php echo esc_attr( $required_attr ); ?> style="resize:vertical; min-height:60px; width:100%; border-radius:6px; padding:0.5rem 0.75rem; background:rgba(255,255,255,0.05); color:#ffffff; border:1px solid rgba(255,255,255,0.1);"></textarea>

										<?php elseif ( 'dropdown' === $ftype ) : ?>
											<select id="cp-prechat-<?php echo esc_attr( $fid ); ?>" class="cp-widget-input cp-prechat-input-field" <?php echo esc_attr( $required_attr ); ?> style="width:100%; border-radius:6px; padding:0.5rem 0.75rem; height:38px; background:rgba(30,41,59,0.8); color:#ffffff; border:1px solid rgba(255,255,255,0.1);">
												<option value="">&mdash; <?php esc_html_e( 'Select Option', 'chat-pilot' ); ?> &mdash;</option>
												<?php foreach ( $options as $opt ) : ?>
													<option value="<?php echo esc_attr( $opt ); ?>"><?php echo esc_html( $opt ); ?></option>
												<?php endforeach; ?>
											</select>

										<?php elseif ( 'radio' === $ftype ) : ?>
											<div style="display:flex; flex-direction:column; gap:0.25rem; margin-top:0.25rem;">
												<?php foreach ( $options as $index => $opt ) : ?>
													<label style="display:flex; align-items:center; gap:0.5rem; font-weight:normal; font-size:0.85rem; cursor:pointer; margin-bottom:0.25rem; color:#cbd5e1;">
														<input type="radio" name="cp-prechat-<?php echo esc_attr( $fid ); ?>" class="cp-prechat-input-field" value="<?php echo esc_attr( $opt ); ?>" <?php echo 0 === $index ? esc_attr( $required_attr ) : ''; ?> style="margin:0; width:16px; height:16px;">
														<?php echo esc_html( $opt ); ?>
													</label>
												<?php endforeach; ?>
											</div>

										<?php else : ?>
											<input type="<?php echo 'email' === $ftype ? 'email' : 'text'; ?>" id="cp-prechat-<?php echo esc_attr( $fid ); ?>" class="cp-widget-input cp-prechat-input-field" placeholder="<?php echo esc_attr( $placeholder ); ?>" <?php echo esc_attr( $required_attr ); ?> style="width:100%; border-radius:6px; padding:0.5rem 0.75rem; height:38px; background:rgba(255,255,255,0.05); color:#ffffff; border:1px solid rgba(255,255,255,0.1);">
										<?php endif; ?>
									</div>
								<?php endif; ?>
							<?php endforeach; ?>
							<button id="cp-widget-prechat-submit" class="cp-widget-btn">
								<span><?php esc_html_e( 'Start Chat', 'chat-pilot' ); ?></span>
								<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:16px; height:16px; margin-left:4px;"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
							</button>
						</div>
					<?php endif; ?>

					<!-- Messages Stream -->
					<div id="cp-widget-messages" style="<?php echo $has_prechat ? 'display: none;' : ''; ?>">
						<div class="cp-widget-msg cp-msg-bot">
							<div class="cp-msg-bubble">
								<?php echo esc_html( $welcome_message ); ?>
							</div>
						</div>

						<?php if ( ! empty( $suggested ) ) : ?>
							<div class="cp-widget-suggestions">
								<?php foreach ( $suggested as $question ) : ?>
									<button class="cp-widget-suggest-btn"><?php echo esc_html( trim( $question ) ); ?></button>
								<?php endforeach; ?>
							</div>
						<?php endif; ?>
					</div>
				</div>

				<!-- Input Form Footer -->
				<div class="cp-widget-footer" style="<?php echo $has_prechat ? 'display: none;' : ''; ?>">
					<form id="cp-widget-input-form">
						<input type="text" id="cp-widget-input-field" class="cp-widget-input" placeholder="<?php echo esc_attr( $placeholder_text ); ?>" autocomplete="off">
						<button type="submit" id="cp-widget-send-btn" aria-label="<?php esc_attr_e( 'Send Message', 'chat-pilot' ); ?>">
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
						</button>
					</form>
					<div class="cp-widget-branding-tag">
						<?php esc_html_e( 'Powered by Chat Pilot', 'chat-pilot' ); ?>
					</div>
				</div>
			</div>
		</div>
		<?php
	}
}
