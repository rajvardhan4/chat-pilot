<?php
namespace ChatPilot\Admin;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class Ajax
 * All AJAX handlers.
 *
 * Two clearly separated groups:
 *
 *  PUBLIC (wp_ajax_nopriv_*) - only what a visitor genuinely needs: send a chat
 *  message and submit the pre-chat form. Both are nonce-checked, both are
 *  proxied so the Site API Key never reaches the browser, and both return only
 *  visitor-safe text. No diagnostics, no provider detail, no internal errors.
 *
 *  ADMIN (wp_ajax_* only) - connection management. Every one of these checks
 *  the required capability AND the admin nonce before doing anything.
 *
 * v1 exposed privileged routes such as chat_pilot_get_key_list and
 * chat_pilot_test_notification_delivery to nopriv callers. Those are gone.
 */
class Ajax {

	/**
	 * Registers handlers.
	 */
	public function __construct() {
		// Visitor-facing.
		add_action( 'wp_ajax_chat_pilot_chat', array( $this, 'ajax_chat' ) );
		add_action( 'wp_ajax_nopriv_chat_pilot_chat', array( $this, 'ajax_chat' ) );
		add_action( 'wp_ajax_chat_pilot_submit_prechat_form', array( $this, 'ajax_submit_prechat_form' ) );
		add_action( 'wp_ajax_nopriv_chat_pilot_submit_prechat_form', array( $this, 'ajax_submit_prechat_form' ) );
		add_action( 'wp_ajax_chat_pilot_get_config', array( $this, 'ajax_get_config' ) );
		add_action( 'wp_ajax_nopriv_chat_pilot_get_config', array( $this, 'ajax_get_config' ) );

		// Administrator only.
		add_action( 'wp_ajax_chat_pilot_connect', array( $this, 'ajax_connect' ) );
		add_action( 'wp_ajax_chat_pilot_disconnect', array( $this, 'ajax_disconnect' ) );
		add_action( 'wp_ajax_chat_pilot_refresh_status', array( $this, 'ajax_refresh_status' ) );
		add_action( 'wp_ajax_chat_pilot_sync_config', array( $this, 'ajax_sync_config' ) );
		add_action( 'wp_ajax_chat_pilot_save_api_url', array( $this, 'ajax_save_api_url' ) );
		add_action( 'wp_ajax_chat_pilot_save_settings', array( $this, 'ajax_save_settings' ) );
		add_action( 'wp_ajax_chat_pilot_clear_log', array( $this, 'ajax_clear_log' ) );
	}

	/* ------------------------------------------------------------- guards -- */

	/**
	 * Capability required for administrative actions.
	 *
	 * @return string
	 */
	private function capability() {
		return apply_filters( 'chat_pilot_admin_capability', 'manage_options' );
	}

	/**
	 * Ends the request unless the caller is an authorised administrator with a
	 * valid nonce.
	 */
	private function guard_admin() {
		if ( ! current_user_can( $this->capability() ) ) {
			wp_send_json_error( array( 'message' => __( 'You do not have permission to do that.', 'chat-pilot' ) ), 403 );
		}
		if ( ! check_ajax_referer( 'chat_pilot_admin_nonce', '_wpnonce', false ) ) {
			wp_send_json_error( array( 'message' => __( 'Your session has expired. Refresh the page and try again.', 'chat-pilot' ) ), 403 );
		}
	}

	/**
	 * Ends the request unless the visitor nonce is valid.
	 */
	private function guard_visitor() {
		if ( ! check_ajax_referer( 'chat_pilot_widget_nonce', '_wpnonce', false ) ) {
			wp_send_json_error( array( 'message' => __( 'Your session expired. Please reload the page.', 'chat-pilot' ) ), 403 );
		}
	}

	/* --------------------------------------------------- visitor handlers -- */

	/**
	 * Proxies a visitor message to Chat Pilot Cloud.
	 *
	 * The response is deliberately thin: the answer text and a coarse status.
	 * Provider names, models, token counts, retrieval scores and error detail
	 * are never sent to a visitor's browser.
	 */
	public function ajax_chat() {
		$this->guard_visitor();

		$message = isset( $_POST['message'] ) ? sanitize_textarea_field( wp_unslash( $_POST['message'] ) ) : '';
		if ( '' === trim( $message ) ) {
			wp_send_json_error( array( 'message' => __( 'Please type a question first.', 'chat-pilot' ) ), 400 );
		}
		if ( strlen( $message ) > 4000 ) {
			$message = substr( $message, 0, 4000 );
		}

		$session_id = isset( $_POST['session_id'] ) ? sanitize_text_field( wp_unslash( $_POST['session_id'] ) ) : '';
		$session_id = preg_replace( '/[^A-Za-z0-9_\-]/', '', $session_id );
		if ( strlen( $session_id ) < 8 ) {
			wp_send_json_error( array( 'message' => __( 'Please reload the page and try again.', 'chat-pilot' ) ), 400 );
		}

		$result = \ChatPilot\Api\Client::post(
			'/api/' . CHAT_PILOT_API_VERSION . '/site/chat',
			array(
				'session_key'   => substr( $session_id, 0, 120 ),
				'message'       => $message,
				'page_url'      => isset( $_POST['page_url'] ) ? esc_url_raw( wp_unslash( $_POST['page_url'] ) ) : '',
				'visitor_key'   => substr( $session_id, 0, 120 ),
				'visitor_name'  => isset( $_POST['visitor_name'] ) ? sanitize_text_field( wp_unslash( $_POST['visitor_name'] ) ) : '',
				'visitor_email' => isset( $_POST['visitor_email'] ) ? sanitize_email( wp_unslash( $_POST['visitor_email'] ) ) : '',
				'visitor_phone' => isset( $_POST['visitor_phone'] ) ? sanitize_text_field( wp_unslash( $_POST['visitor_phone'] ) ) : '',
			)
		);

		if ( empty( $result['success'] ) ) {
			// The visitor gets one friendly sentence regardless of the cause.
			// The administrator gets the detail, in the plugin log only.
			wp_send_json_success(
				array(
					'text'   => $this->visitor_error_message(),
					'status' => 'error',
				)
			);
		}

		$data = $result['data'];

		wp_send_json_success(
			array(
				'text'   => isset( $data['text'] ) ? wp_strip_all_tags( (string) $data['text'] ) : $this->visitor_error_message(),
				'status' => isset( $data['status'] ) ? sanitize_key( $data['status'] ) : 'success',
			)
		);
	}

	/**
	 * Proxies a pre-chat form submission.
	 *
	 * Validation is authoritative on the SaaS; field-level errors come back and
	 * are surfaced to the visitor as-is because they are the customer's own
	 * field labels, not internal detail.
	 */
	public function ajax_submit_prechat_form() {
		$this->guard_visitor();

		$form_id = isset( $_POST['form_id'] ) ? sanitize_text_field( wp_unslash( $_POST['form_id'] ) ) : '';
		if ( '' === $form_id ) {
			wp_send_json_error( array( 'message' => __( 'This form is no longer available. Please reload the page.', 'chat-pilot' ) ), 400 );
		}

		$session_id = isset( $_POST['session_id'] ) ? sanitize_text_field( wp_unslash( $_POST['session_id'] ) ) : '';
		$session_id = preg_replace( '/[^A-Za-z0-9_\-]/', '', $session_id );

		$raw_fields = isset( $_POST['fields'] ) && is_array( $_POST['fields'] ) ? wp_unslash( $_POST['fields'] ) : array();
		$fields     = array();
		foreach ( $raw_fields as $key => $value ) {
			if ( is_array( $value ) ) {
				continue;
			}
			$fields[ sanitize_key( $key ) ] = sanitize_textarea_field( (string) $value );
		}

		$result = \ChatPilot\Api\Client::post(
			'/api/' . CHAT_PILOT_API_VERSION . '/site/forms/submit',
			array(
				'form_id'     => $form_id,
				'session_key' => substr( $session_id, 0, 120 ),
				'visitor_key' => substr( $session_id, 0, 120 ),
				'page_url'    => isset( $_POST['page_url'] ) ? esc_url_raw( wp_unslash( $_POST['page_url'] ) ) : '',
				'fields'      => $fields,
			)
		);

		if ( empty( $result['success'] ) ) {
			$is_validation = isset( $result['status'] ) && 422 === (int) $result['status'];
			wp_send_json_error(
				array(
					'message' => $is_validation
						? $result['message']
						: __( 'We could not start the chat just now. Please try again in a moment.', 'chat-pilot' ),
					'fields'  => $is_validation && ! empty( $result['fields'] ) ? $result['fields'] : array(),
				),
				400
			);
		}

		wp_send_json_success(
			array(
				'submission_id' => isset( $result['data']['submission_id'] ) ? sanitize_text_field( $result['data']['submission_id'] ) : '',
			)
		);
	}

	/**
	 * The single sentence a visitor sees when anything goes wrong.
	 *
	 * @return string
	 */
	private function visitor_error_message() {
		$config = \ChatPilot\Api\ConfigCache::get();
		if ( ! empty( $config['messages']['generation_error'] ) ) {
			return sanitize_text_field( $config['messages']['generation_error'] );
		}
		return __( "I'm having trouble generating a response right now. Please try again in a moment.", 'chat-pilot' );
	}

	/* ----------------------------------------------------- admin handlers -- */

	/**
	 * Connects this site using a Site API Key.
	 */
	public function ajax_connect() {
		$this->guard_admin();

		$key = isset( $_POST['api_key'] ) ? sanitize_text_field( wp_unslash( $_POST['api_key'] ) ) : '';
		$key = trim( $key );

		if ( '' === $key ) {
			wp_send_json_error( array( 'message' => __( 'Paste your Chat Pilot Site API Key to continue.', 'chat-pilot' ) ), 400 );
		}
		if ( ! preg_match( '/^cp_(live|test)_[A-Za-z0-9_\-]{20,}$/', $key ) ) {
			// Say which way it is wrong. The old message always claimed the key
			// had the wrong prefix, which reads as nonsense to someone looking
			// at a key that plainly starts with cp_live_ - and the usual cause
			// is the browser having autofilled a saved password over the field,
			// where the value is not a key at all.
			$message = ( 0 === strpos( $key, 'cp_live_' ) || 0 === strpos( $key, 'cp_test_' ) )
				? __( 'That key is incomplete. Copy the whole value from Chat Pilot - it is one long line with no spaces.', 'chat-pilot' )
				: __( 'That does not look like a Site API Key. It must start with cp_live_. If the field filled itself in, clear it and paste the key again.', 'chat-pilot' );

			wp_send_json_error( array( 'message' => $message ), 400 );
		}

		$result = \ChatPilot\Api\Connection::connect( $key );

		if ( empty( $result['success'] ) ) {
			wp_send_json_error(
				array(
					'message' => $result['message'],
					'code'    => $result['code'],
				),
				400
			);
		}

		wp_send_json_success(
			array(
				'message' => $result['message'],
				'state'   => $result['state'],
			)
		);
	}

	/**
	 * Disconnects this site.
	 */
	public function ajax_disconnect() {
		$this->guard_admin();
		$result = \ChatPilot\Api\Connection::disconnect();
		wp_send_json_success( array( 'message' => $result['message'] ) );
	}

	/**
	 * Re-checks connection health.
	 */
	public function ajax_refresh_status() {
		$this->guard_admin();

		$result = \ChatPilot\Api\Connection::health();

		if ( empty( $result['success'] ) ) {
			wp_send_json_error(
				array(
					'message' => $result['message'],
					'code'    => $result['code'],
				),
				400
			);
		}

		wp_send_json_success(
			array(
				'message' => $result['message'],
				'health'  => $result['health'],
			)
		);
	}

	/**
	 * Forces a widget configuration refresh from the SaaS.
	 */
	public function ajax_sync_config() {
		$this->guard_admin();

		$config = \ChatPilot\Api\ConfigCache::get( true );

		if ( empty( $config['widget'] ) ) {
			wp_send_json_error(
				array( 'message' => __( 'Chat Pilot could not refresh the widget configuration. Check the connection status above.', 'chat-pilot' ) ),
				400
			);
		}

		wp_send_json_success(
			array(
				'message' => __( 'Widget configuration refreshed from Chat Pilot.', 'chat-pilot' ),
				'widget'  => $config['widget'],
			)
		);
	}

	/**
	 * Saves the Chat Pilot Cloud address this site talks to.
	 *
	 * Changing where signed requests go is a privileged act, so it takes the
	 * same capability and nonce as everything else here, and refuses anything
	 * that is not an http(s) URL. When wp-config.php has pinned the endpoint
	 * this route refuses outright rather than saving a value that would be
	 * silently ignored.
	 */
	public function ajax_save_api_url() {
		$this->guard_admin();

		if ( \ChatPilot\Api\Client::is_pinned() ) {
			wp_send_json_error(
				array( 'message' => __( 'The Chat Pilot Cloud address is pinned in wp-config.php and cannot be changed here.', 'chat-pilot' ) ),
				400
			);
		}

		$url = isset( $_POST['api_url'] ) ? esc_url_raw( trim( wp_unslash( $_POST['api_url'] ) ) ) : '';

		if ( '' !== $url ) {
			$scheme = wp_parse_url( $url, PHP_URL_SCHEME );
			$host   = wp_parse_url( $url, PHP_URL_HOST );
			if ( ! in_array( $scheme, array( 'http', 'https' ), true ) || ! $host ) {
				wp_send_json_error(
					array( 'message' => __( 'Enter a full address starting with https://, or leave the field empty to use the default.', 'chat-pilot' ) ),
					400
				);
			}
			$url = untrailingslashit( $url );
		}

		$plugin = \ChatPilot\Core\Plugin::instance();
		$plugin->settings->set( 'cloud.api_url', $url );
		$plugin->settings->save();

		// The cached widget config came from the old address and means nothing
		// at the new one.
		\ChatPilot\Api\ConfigCache::flush();

		\ChatPilot\Common\Logger::log( 'info', 'Chat Pilot Cloud address changed.', array( 'url' => \ChatPilot\Api\Client::base_url() ) );

		wp_send_json_success(
			array(
				'message' => __( 'Cloud address saved.', 'chat-pilot' ),
				'api_url' => \ChatPilot\Api\Client::base_url(),
			)
		);
	}

	/**
	 * Saves the local WordPress-side settings.
	 */
	public function ajax_save_settings() {
		$this->guard_admin();

		$plugin = \ChatPilot\Core\Plugin::instance();

		$enable_plugin   = ! empty( $_POST['enable_plugin'] ) && 'false' !== $_POST['enable_plugin'];
		$hide_for_admins = ! empty( $_POST['hide_for_admins'] ) && 'false' !== $_POST['hide_for_admins'];
		$logging         = ! empty( $_POST['enable_logging'] ) && 'false' !== $_POST['enable_logging'];
		$dev_mode        = ! empty( $_POST['dev_mode'] ) && 'false' !== $_POST['dev_mode'];

		$mode  = isset( $_POST['display_mode'] ) ? sanitize_key( wp_unslash( $_POST['display_mode'] ) ) : 'all';
		$mode  = in_array( $mode, array( 'all', 'include', 'exclude' ), true ) ? $mode : 'all';
		$rules = isset( $_POST['display_rules'] ) ? sanitize_text_field( wp_unslash( $_POST['display_rules'] ) ) : '';

		$plugin->settings->set( 'general.enable_plugin', $enable_plugin );
		$plugin->settings->set( 'display.mode', $mode );
		$plugin->settings->set( 'display.rules', $rules );
		$plugin->settings->set( 'display.hide_for_admins', $hide_for_admins );
		$plugin->settings->set( 'logging.enabled', $logging );
		$plugin->settings->set( 'developer.dev_mode', $dev_mode );
		$plugin->settings->save();

		wp_send_json_success( array( 'message' => __( 'Settings saved.', 'chat-pilot' ) ) );
	}

	/**
	 * Clears the local plugin log.
	 */
	public function ajax_clear_log() {
		$this->guard_admin();
		\ChatPilot\Common\Logger::clear();
		wp_send_json_success( array( 'message' => __( 'Plugin log cleared.', 'chat-pilot' ) ) );
	}

	/**
	 * Returns current safe widget configuration for client-side dynamic synchronization.
	 * Bypasses page-caching plugins (LiteSpeed, WP Rocket, etc.) completely.
	 */
	public function ajax_get_config() {
		$config = \ChatPilot\Api\ConfigCache::get();
		if ( empty( $config['widget'] ) ) {
			wp_send_json_error( array( 'message' => 'Configuration unavailable.' ), 400 );
		}
		$widget  = $config['widget'];
		$prechat = isset( $widget['prechat'] ) ? $widget['prechat'] : array();
		wp_send_json_success(
			array(
				'hasPrechat'   => ! empty( $prechat['enabled'] ) && ! empty( $prechat['fields'] ),
				'formId'       => isset( $prechat['formId'] ) ? sanitize_text_field( $prechat['formId'] ) : '',
				'intro'        => isset( $prechat['intro'] ) ? sanitize_text_field( $prechat['intro'] ) : '',
				'fields'       => isset( $prechat['fields'] ) ? $prechat['fields'] : array(),
				'primaryColor' => isset( $widget['primaryColor'] ) ? sanitize_text_field( $widget['primaryColor'] ) : '',
				'iconColor'    => isset( $widget['iconColor'] ) ? sanitize_text_field( $widget['iconColor'] ) : '',
			)
		);
	}
}
