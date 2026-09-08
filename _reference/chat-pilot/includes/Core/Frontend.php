<?php
namespace ChatPilot\Core;

// Prevent direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class Frontend
 * Coordinates frontend widget rendering, styling enqueues, and client configurations.
 */
class Frontend {

	/**
	 * Constructor.
	 * Hooks into the script enqueuing and rendering lifecycle.
	 */
	public function __construct() {
		add_action( 'wp_enqueue_scripts', array( $this, 'enqueue_frontend_assets' ) );
		add_action( 'wp_footer', array( $this, 'render_chat_widget' ) );
	}

	/**
	 * Enqueues CSS and JS styles for the public visitor widget.
	 */
	public function enqueue_frontend_assets() {
		$plugin = Plugin::instance();

		// Exit early if plugin or widget is disabled
		$enable_plugin = $plugin->settings->get( 'general.enable_plugin', true );
		$enable_widget = $plugin->settings->get( 'widget.enable_widget', true );

		if ( ! $enable_plugin || ! $enable_widget ) {
			return;
		}

		$version = CHAT_PILOT_VERSION;
		$dev_mode = $plugin->settings->get( 'general.dev_mode', false );
		if ( $dev_mode ) {
			$version = $version . '.' . time();
		}

		// Enqueue styling sheets
		wp_enqueue_style(
			'chat-pilot-widget-css',
			CHAT_PILOT_URL . 'assets/css/widget-style.css',
			array(),
			$version,
			'all'
		);

		// Enqueue logic script
		wp_enqueue_script(
			'chat-pilot-widget-js',
			CHAT_PILOT_URL . 'assets/js/widget-script.js',
			array( 'jquery' ),
			$version,
			true
		);

		// Localize widget parameters for script enqueuing
		$suggested_raw = $plugin->settings->get( 'widget.suggested_questions', '' );
		$suggested_arr = array_filter( array_map( 'trim', explode( "\n", str_replace( "\r", '', $suggested_raw ) ) ) );

		$form_manager = new \ChatPilot\Forms\FormManager();
		$default_form = $form_manager->get_default_form();
		$form_fields  = array();
		$has_prechat  = false;
		$form_id      = 0;

		if ( $default_form && 'active' === $default_form['status'] ) {
			$form_id = $default_form['id'];
			foreach ( $default_form['fields'] as $f ) {
				$enabled = isset( $f['enabled'] ) ? (bool) $f['enabled'] : true;
				if ( ! $enabled ) {
					continue;
				}
				$has_prechat = true;
				$form_fields[] = array(
					'id'          => $f['id'],
					'type'        => $f['type'],
					'label'       => $f['label'],
					'placeholder' => isset( $f['placeholder'] ) ? $f['placeholder'] : '',
					'required'    => isset( $f['required'] ) ? (bool) $f['required'] : false,
					'validation'  => isset( $f['validation'] ) ? $f['validation'] : 'none',
				);
			}
		}

		wp_localize_script(
			'chat-pilot-widget-js',
			'chatPilotWidget',
			array(
				'ajaxUrl'            => admin_url( 'admin-ajax.php' ),
				'securityNonce'      => wp_create_nonce( 'chat_pilot_widget_nonce' ),
				'position'           => $plugin->settings->get( 'widget.position', 'bottom-right' ),
				'primaryColor'       => $plugin->settings->get( 'widget.primary_color', '#06b6d4' ),
				'welcomeMessage'     => $plugin->settings->get( 'widget.welcome_message', 'Hi there! How can I help you today?' ),
				'placeholderText'    => $plugin->settings->get( 'widget.placeholder_text', 'Ask a question...' ),
				'suggestedQuestions' => array_values( $suggested_arr ),
				'hasPrechat'         => $has_prechat,
				'formId'             => $form_id,
				'formFields'         => $form_fields,
				'collectName'        => $plugin->settings->get( 'widget.collect_name', false ),
				'collectEmail'       => $plugin->settings->get( 'widget.collect_email', false ),
				'collectPhone'       => $plugin->settings->get( 'widget.collect_phone', false ),
				'enableTyping'       => $plugin->settings->get( 'widget.enable_typing', true ),
				'enableStreaming'    => $plugin->settings->get( 'widget.enable_streaming', true ),
				'autoOpenChat'       => $plugin->settings->get( 'widget.auto_open_chat', true ),
				'openOncePerVisitor' => $plugin->settings->get( 'widget.open_once_per_visitor', true ),
				'autoOpenDelay'      => intval( $plugin->settings->get( 'widget.auto_open_delay', 5 ) ),
				'logoUrl'            => $plugin->settings->get( 'widget.logo_url', '' ),
				'pluginName'         => $plugin->settings->get( 'general.plugin_name', 'Chat Pilot' ),
			)
		);
	}

	/**
	 * Renders floating chat widget markup inside footer context.
	 */
	public function render_chat_widget() {
		$plugin = Plugin::instance();

		// Exit early if plugin or widget is disabled
		$enable_plugin = $plugin->settings->get( 'general.enable_plugin', true );
		$enable_widget = $plugin->settings->get( 'widget.enable_widget', true );

		if ( ! $enable_plugin || ! $enable_widget ) {
			return;
		}

		$plugin_name      = $plugin->settings->get( 'general.plugin_name', 'Chat Pilot' );
		$position         = $plugin->settings->get( 'widget.position', 'bottom-right' );
		$primary_color    = $plugin->settings->get( 'widget.primary_color', '#06b6d4' );
		$welcome_message  = $plugin->settings->get( 'widget.welcome_message', 'Hi there! How can I help you today?' );
		$placeholder_text = $plugin->settings->get( 'widget.placeholder_text', 'Ask a question...' );
		$logo_url         = $plugin->settings->get( 'widget.logo_url', '' );

		$collect_name  = $plugin->settings->get( 'widget.collect_name', false );
		$collect_email = $plugin->settings->get( 'widget.collect_email', false );
		$collect_phone = $plugin->settings->get( 'widget.collect_phone', false );

		$suggested_raw = $plugin->settings->get( 'widget.suggested_questions', '' );
		$suggested_arr = array_filter( array_map( 'trim', explode( "\n", str_replace( "\r", '', $suggested_raw ) ) ) );

		$form_manager = new \ChatPilot\Forms\FormManager();
		$default_form = $form_manager->get_default_form();
		$has_prechat  = false;
		$form_id      = 0;

		if ( $default_form && 'active' === $default_form['status'] && ! empty( $default_form['fields'] ) ) {
			$form_id = $default_form['id'];
			foreach ( $default_form['fields'] as $f ) {
				$enabled = isset( $f['enabled'] ) ? (bool) $f['enabled'] : true;
				if ( $enabled ) {
					$has_prechat = true;
					break;
				}
			}
		}
		?>
		<div id="chat-pilot-widget-container" class="cp-widget-position-<?php echo esc_attr( $position ); ?>" style="--cp-primary-color: <?php echo esc_attr( $primary_color ); ?>;">
			<!-- Launcher Button -->
			<button id="chat-pilot-widget-launcher" aria-label="<?php esc_attr_e( 'Open Chat', 'chat-pilot' ); ?>">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="cp-launcher-icon-open"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="cp-launcher-icon-close" style="display:none;"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
			</button>

			<!-- Chat Window -->
			<div id="chat-pilot-widget-box" style="display: none;">
				<!-- Header -->
				<div class="cp-widget-header">
					<div class="cp-widget-brand">
						<?php if ( ! empty( $logo_url ) ) : ?>
							<img src="<?php echo esc_url( $logo_url ); ?>" alt="<?php esc_attr_e( 'Logo', 'chat-pilot' ); ?>" class="cp-widget-logo">
						<?php else : ?>
							<div class="cp-widget-logo-placeholder">🤖</div>
						<?php endif; ?>
						<div class="cp-widget-brand-text">
							<h3 class="cp-widget-title"><?php echo esc_html( $plugin_name ); ?></h3>
							<span class="cp-widget-subtitle"><?php esc_html_e( 'AI Assistant', 'chat-pilot' ); ?></span>
						</div>
					</div>
					<button id="chat-pilot-widget-close" aria-label="<?php esc_attr_e( 'Close Chat', 'chat-pilot' ); ?>">✕</button>
				</div>

				<!-- Chat Area -->
				<div class="cp-widget-body">
					<!-- Pre-chat Form (Optional) -->
					<?php if ( $has_prechat ) : ?>
						<div id="cp-widget-prechat-form" data-form-id="<?php echo esc_attr( $form_id ); ?>">
							<p class="cp-widget-prechat-intro"><?php esc_html_e( 'Please introduce yourself to start the conversation.', 'chat-pilot' ); ?></p>
							<div class="cp-prechat-error-msg" style="display:none; color:#ef4444; font-size:0.85rem; margin-bottom:0.75rem; border:1px solid rgba(239,68,68,0.15); background:rgba(239,68,68,0.05); padding:0.5rem 0.75rem; border-radius:6px; line-height:1.4;"></div>
							<?php
							foreach ( $default_form['fields'] as $field ) {
								$enabled = isset( $field['enabled'] ) ? (bool) $field['enabled'] : true;
								if ( ! $enabled ) {
									continue;
								}
								$fid           = esc_attr( $field['id'] );
								$label         = esc_html( $field['label'] );
								$placeholder   = esc_attr( isset( $field['placeholder'] ) ? $field['placeholder'] : '' );
								$required_star = ( isset( $field['required'] ) && $field['required'] ) ? ' <span class="cp-required-star" style="color:#ef4444;">*</span>' : '';
								$required_attr = ( isset( $field['required'] ) && $field['required'] ) ? 'required' : '';
								
								$is_checkbox = ( $field['type'] === 'checkbox' );
								if ( $is_checkbox ) {
									echo '<div class="cp-widget-form-group cp-widget-form-checkbox" style="display:flex; align-items:center; gap:0.5rem; margin-bottom:0.75rem;">';
									echo '<input type="checkbox" id="cp-prechat-' . $fid . '" class="cp-prechat-input-field" value="1" ' . $required_attr . ' style="margin:0; width:16px; height:16px; cursor:pointer;">';
									echo '<label for="cp-prechat-' . $fid . '" style="margin:0; cursor:pointer; font-weight:normal; font-size:0.85rem;">' . $label . $required_star . '</label>';
									echo '</div>';
								} else {
									echo '<div class="cp-widget-form-group" style="margin-bottom:0.75rem;">';
									echo '<label for="cp-prechat-' . $fid . '" style="display:block; font-size:0.85rem; font-weight:600; margin-bottom:0.25rem;">' . $label . $required_star . '</label>';
									
									if ( $field['type'] === 'textarea' || $field['type'] === 'message' ) {
										echo '<textarea id="cp-prechat-' . $fid . '" class="cp-widget-input cp-prechat-input-field" placeholder="' . $placeholder . '" ' . $required_attr . ' style="resize:vertical; min-height:60px; width:100%; border-radius:6px; padding:0.5rem 0.75rem; background:rgba(255,255,255,0.05); color:#ffffff; border:1px solid rgba(255,255,255,0.1);"></textarea>';
									} elseif ( $field['type'] === 'dropdown' || $field['type'] === 'select' ) {
										$options = array_filter( array_map( 'trim', explode( "\n", str_replace( "\r", '', $field['options'] ) ) ) );
										echo '<select id="cp-prechat-' . $fid . '" class="cp-widget-input cp-prechat-input-field" ' . $required_attr . ' style="width:100%; border-radius:6px; padding:0.5rem 0.75rem; height:38px; background:rgba(30,41,59,0.8); color:#ffffff; border:1px solid rgba(255,255,255,0.1);">';
										echo '<option value="">— Select Option —</option>';
										foreach ( $options as $opt ) {
											echo '<option value="' . esc_attr( $opt ) . '">' . esc_html( $opt ) . '</option>';
										}
										echo '</select>';
									} elseif ( $field['type'] === 'radio' ) {
										$options = array_filter( array_map( 'trim', explode( "\n", str_replace( "\r", '', $field['options'] ) ) ) );
										echo '<div style="display:flex; flex-direction:column; gap:0.25rem; margin-top:0.25rem;">';
										foreach ( $options as $idx => $opt ) {
											echo '<label style="display:flex; align-items:center; gap:0.5rem; font-weight:normal; font-size:0.85rem; cursor:pointer; margin-bottom:0.25rem; color:#cbd5e1;">';
											echo '<input type="radio" name="cp-prechat-' . $fid . '" class="cp-prechat-input-field" value="' . esc_attr( $opt ) . '" ' . ($idx === 0 ? $required_attr : '') . ' style="margin:0; width:16px; height:16px;">';
											echo esc_html( $opt );
											echo '</label>';
										}
										echo '</div>';
									} else {
										$input_type = ( $field['type'] === 'email' ) ? 'email' : 'text';
										echo '<input type="' . $input_type . '" id="cp-prechat-' . $fid . '" class="cp-widget-input cp-prechat-input-field" placeholder="' . $placeholder . '" ' . $required_attr . ' style="width:100%; border-radius:6px; padding:0.5rem 0.75rem; height:38px; background:rgba(255,255,255,0.05); color:#ffffff; border:1px solid rgba(255,255,255,0.1);">';
									}
									echo '</div>';
								}
							}
							?>
							<button id="cp-widget-prechat-submit" class="cp-widget-btn"><?php esc_html_e( 'Start Chat', 'chat-pilot' ); ?></button>
						</div>
					<?php endif; ?>

					<!-- Messages Stream -->
					<div id="cp-widget-messages" style="<?php echo $has_prechat ? 'display: none;' : ''; ?>">
						<!-- Welcome message card -->
						<div class="cp-widget-msg cp-msg-bot">
							<div class="cp-msg-bubble">
								<?php echo esc_html( $welcome_message ); ?>
							</div>
						</div>

						<!-- Suggested Questions List -->
						<?php if ( ! empty( $suggested_arr ) ) : ?>
							<div class="cp-widget-suggestions">
								<?php foreach ( $suggested_arr as $q ) : ?>
									<button class="cp-widget-suggest-btn"><?php echo esc_html( trim( $q ) ); ?></button>
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
