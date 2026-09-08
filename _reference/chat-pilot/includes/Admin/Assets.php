<?php
namespace ChatPilot\Admin;

// Prevent direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class Assets
 * Handles conditional registration and enqueuing of plugin administrative assets.
 */
class Assets {

	/**
	 * Constructor.
	 * Hooks into the script enqueuing lifecycle.
	 */
	public function __construct() {
		add_action( 'admin_enqueue_scripts', array( $this, 'enqueue_admin_assets' ) );
	}

	/**
	 * Enqueues CSS and JS styles on plugin pages only.
	 *
	 * @param string $hook The current admin page hook screen string.
	 */
	public function enqueue_admin_assets( $hook ) {
		// Only load assets on the Chat Pilot settings page.
		if ( 'toplevel_page_chat-pilot' !== $hook ) {
			return;
		}

		// Retrieve active version with dev-mode cache busting.
		$version = CHAT_PILOT_VERSION;
		$dev_mode = false;

		// Safe retrieval check of settings if instantiated.
		$plugin = \ChatPilot\Core\Plugin::instance();
		if ( isset( $plugin->settings ) ) {
			$dev_mode = $plugin->settings->get( 'general.dev_mode', false );
		}

		if ( $dev_mode ) {
			$version = $version . '.' . time(); // Append Unix timestamp to bypass cache.
		}

		// Enqueue dashboard stylesheets.
		wp_enqueue_style(
			'chat-pilot-admin-css',
			CHAT_PILOT_URL . 'assets/css/admin-style.css',
			array(),
			$version,
			'all'
		);

		// Enqueue dashboard logic script.
		wp_enqueue_script(
			'chat-pilot-admin-js',
			CHAT_PILOT_URL . 'assets/js/admin-script.js',
			array( 'jquery' ),
			$version,
			true
		);

		$collect_name    = isset( $plugin->settings ) ? $plugin->settings->get( 'widget.collect_name', false ) : false;
		$collect_email   = isset( $plugin->settings ) ? $plugin->settings->get( 'widget.collect_email', false ) : false;
		$collect_phone   = isset( $plugin->settings ) ? $plugin->settings->get( 'widget.collect_phone', false ) : false;
		$prechat_enabled = ( $collect_name || $collect_email || $collect_phone );

		$form_manager = new \ChatPilot\Forms\FormManager();
		$default_form = $form_manager->get_default_form();
		$all_forms    = $form_manager->get_forms();
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
				$has_prechat = $prechat_enabled;
				$form_fields[] = array(
					'id'          => $f['id'],
					'type'        => $f['type'],
					'label'       => $f['label'],
					'placeholder' => isset( $f['placeholder'] ) ? $f['placeholder'] : '',
					'required'    => isset( $f['required'] ) ? (bool) $f['required'] : false,
					'options'     => isset( $f['options'] ) ? $f['options'] : '',
					'validation'  => isset( $f['validation'] ) ? $f['validation'] : 'none',
				);
			}
		}

		// Localize parameters for use in JS (ajaxurl, nonces).
		wp_localize_script(
			'chat-pilot-admin-js',
			'chatPilotAdmin',
			array(
				'ajaxUrl'         => admin_url( 'admin-ajax.php' ),
				'securityNonce'   => wp_create_nonce( 'chat_pilot_admin_nonce' ),
				'widgetNonce'     => wp_create_nonce( 'chat_pilot_widget_nonce' ),
				'devMode'         => $dev_mode,
				'defaultProvider' => isset( $plugin->settings ) ? $plugin->settings->get( 'default_provider', '' ) : '',
				'defaultModel'    => isset( $plugin->settings ) ? $plugin->settings->get( 'default_model', '' ) : '',
				'hasPrechat'      => $has_prechat,
				'prechatEnabled'  => $prechat_enabled,
				'formId'          => $form_id,
				'formFields'      => $form_fields,
				'allForms'        => $all_forms,
			)
		);
	}
}
