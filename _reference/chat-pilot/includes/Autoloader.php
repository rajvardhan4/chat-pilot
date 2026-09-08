<?php
namespace ChatPilot;

// Prevent direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class Autoloader
 * PSR-4 compliant autoloader for Chat Pilot.
 */
class Autoloader {

	/**
	 * Register the autoloader.
	 */
	public static function register() {
		spl_autoload_register( array( __CLASS__, 'autoload' ) );
	}

	/**
	 * Autoload handler for classes in the ChatPilot namespace.
	 *
	 * @param string $class The class name to load.
	 */
	public static function autoload( $class ) {
		// Class namespace prefix.
		$prefix = 'ChatPilot\\';

		// Base directory for the namespace prefix.
		$base_dir = CHAT_PILOT_PATH . 'includes/';

		// Check if the class uses the prefix.
		$len = strlen( $prefix );
		if ( strncmp( $prefix, $class, $len ) !== 0 ) {
			return;
		}

		// Get the relative class name.
		$relative_class = substr( $class, $len );

		// Replace namespace separators with directory separators, append .php.
		$file = $base_dir . str_replace( '\\', '/', $relative_class ) . '.php';

		// If the file exists, require it.
		if ( file_exists( $file ) ) {
			require_once $file;
		}
	}
}
