<?php
namespace ChatPilot;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class Autoloader
 * PSR-4 style autoloader for the ChatPilot namespace.
 */
class Autoloader {

	/**
	 * Registers the autoloader with SPL.
	 */
	public static function register() {
		spl_autoload_register( array( __CLASS__, 'autoload' ) );
	}

	/**
	 * Resolves a ChatPilot class name to a file under includes/.
	 *
	 * @param string $class Fully qualified class name.
	 */
	public static function autoload( $class ) {
		$prefix   = 'ChatPilot\\';
		$base_dir = CHAT_PILOT_PATH . 'includes/';

		$len = strlen( $prefix );
		if ( strncmp( $prefix, $class, $len ) !== 0 ) {
			return;
		}

		$relative = substr( $class, $len );
		$file     = $base_dir . str_replace( '\\', '/', $relative ) . '.php';

		if ( file_exists( $file ) ) {
			require_once $file;
		}
	}
}
