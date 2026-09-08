<?php
namespace ChatPilot\Database;

// Prevent direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class Migration
 * Orchestrates version monitoring and executes incremental database upgrades.
 */
class Migration {

	/**
	 * Constructor. Performs routine version validation checks.
	 */
	public function __construct() {
		add_action( 'plugins_loaded', array( $this, 'check_and_run_migrations' ), 20 );
	}

	/**
	 * Checks current database version and triggers upgrade routines if outdated.
	 */
	public function check_and_run_migrations() {
		// Run checks only in admin context or during activation.
		if ( ! is_admin() ) {
			return;
		}

		$plugin = \ChatPilot\Core\Plugin::instance();
		
		// If settings repository isn't loaded yet, bypass.
		if ( ! isset( $plugin->settings ) ) {
			return;
		}

		$current_db_version = $plugin->settings->get( 'system.db_version', '0.0.0' );
		$target_version     = CHAT_PILOT_VERSION;

		if ( version_compare( $current_db_version, $target_version, '<' ) ) {
			$this->upgrade_database( $current_db_version, $target_version );
		}
	}

	/**
	 * Upgrades database schema structure and seeds options changes.
	 *
	 * @param string $from Version upgrading from.
	 * @param string $to   Version upgrading to.
	 */
	private function upgrade_database( $from, $to ) {
		// 1. Run Schema Table upgrades using dbDelta structure checks.
		$schema = new Schema();
		$schema->create_tables();

		// 2. Perform version specific upgrades here in future phases.
		
		// 3. Update saved database system version.
		$plugin = \ChatPilot\Core\Plugin::instance();
		$plugin->settings->set( 'system.db_version', $to );
		$plugin->settings->save();

		// Log migration event.
		\ChatPilot\Common\Logger::log(
			'info',
			sprintf( 'Database migrated successfully from version %s to %s.', $from, $to )
		);
	}
}
