<?php
namespace ChatPilot\Core;

// Prevent direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class Plugin
 * The main bootstrap container and coordinator for the Chat Pilot plugin.
 */
class Plugin {

	/**
	 * Singleton instance of the plugin class.
	 *
	 * @var Plugin|null
	 */
	private static $instance = null;

	/**
	 * Settings repository instance.
	 *
	 * @var \ChatPilot\Settings\Repository
	 */
	public $settings;

	/**
	 * Security verification instance.
	 *
	 * @var \ChatPilot\Security\Verification
	 */
	public $security;

	/**
	 * Database schema/migration coordinator.
	 *
	 * @var \ChatPilot\Database\Migration
	 */
	public $database;

	/**
	 * AI Provider manager coordinator.
	 *
	 * @var \ChatPilot\Providers\ProviderManager
	 */
	public $providers;

	/**
	 * Admin dashboard menu controller.
	 *
	 * @var \ChatPilot\Admin\Menu
	 */
	public $admin_menu;

	/**
	 * Static asset manager.
	 *
	 * @var \ChatPilot\Admin\Assets
	 */
	public $assets;

	/**
	 * Dashboard tabs view controller.
	 *
	 * @var \ChatPilot\Admin\TabsController
	 */
	public $tabs;

	/**
	 * Retrieves the single instance of this class.
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
	 * Plugin constructor.
	 * Registers autoloader systems and boots subsystems.
	 */
	private function __construct() {
		$this->init_components();
	}

	/**
	 * Instantiates and coordinates all subsystems.
	 */
	private function init_components() {
		// Initialize settings repository first, as other classes depend on it.
		$this->settings = new \ChatPilot\Settings\Repository();

		// Initialize security manager.
		$this->security = new \ChatPilot\Security\Verification();

		// Initialize database manager.
		$this->database = new \ChatPilot\Database\Migration();

		// Initialize AI Providers manager.
		$this->providers = new \ChatPilot\Providers\ProviderManager();

		// Initialize admin controllers.
		$this->admin_menu = new \ChatPilot\Admin\Menu();
		$this->assets     = new \ChatPilot\Admin\Assets();
		$this->tabs       = new \ChatPilot\Admin\TabsController();

		// Initialize frontend widget controllers.
		new \ChatPilot\Core\Frontend();
	}

	/**
	 * Clones are disabled for Singletons.
	 */
	private function __clone() {}

	/**
	 * Unserialization is disabled for Singletons.
	 */
	public function __wakeup() {}
}
