<?php
namespace ChatPilot\Core;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class Plugin
 * Bootstrap container.
 *
 * Compared with v1 this is deliberately small: there is no provider manager,
 * no retrieval engine, no knowledge manager and no analytics manager, because
 * all of that now lives in Chat Pilot Cloud.
 */
class Plugin {

	/**
	 * Singleton instance.
	 *
	 * @var Plugin|null
	 */
	private static $instance = null;

	/**
	 * Local plugin settings.
	 *
	 * @var \ChatPilot\Settings\Repository
	 */
	public $settings;

	/**
	 * Admin menu controller.
	 *
	 * @var \ChatPilot\Admin\Menu
	 */
	public $admin_menu;

	/**
	 * Admin asset loader.
	 *
	 * @var \ChatPilot\Admin\Assets
	 */
	public $assets;

	/**
	 * Admin tab router.
	 *
	 * @var \ChatPilot\Admin\TabsController
	 */
	public $tabs;

	/**
	 * Returns the singleton.
	 *
	 * @return Plugin
	 */
	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	/**
	 * Boots subsystems.
	 */
	private function __construct() {
		$this->settings = new \ChatPilot\Settings\Repository();

		if ( is_admin() ) {
			$this->admin_menu = new \ChatPilot\Admin\Menu();
			$this->assets     = new \ChatPilot\Admin\Assets();
			$this->tabs       = new \ChatPilot\Admin\TabsController();
		}

		// AJAX proxies must be registered in both admin and frontend contexts.
		new \ChatPilot\Admin\Ajax();

		// Ownership verification endpoint + widget rendering.
		new \ChatPilot\Core\Rest();
		new \ChatPilot\Core\Frontend();
	}

	/**
	 * Singletons are not cloneable.
	 */
	private function __clone() {}

	/**
	 * Singletons are not unserializable.
	 */
	public function __wakeup() {}
}
