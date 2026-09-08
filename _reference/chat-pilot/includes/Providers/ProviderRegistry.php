<?php
namespace ChatPilot\Providers;

// Prevent direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class ProviderRegistry
 * Maintains a map of driver tags and their target class paths.
 */
class ProviderRegistry {

	/**
	 * Map of registered adapters.
	 *
	 * @var array
	 */
	private static $registry = array(
		'openai' => 'ChatPilot\Providers\OpenAIProvider',
		'gemini' => 'ChatPilot\Providers\GeminiProvider',
	);

	/**
	 * Retrieves the mapped class path for a provider slug.
	 *
	 * @param string $slug Provider driver identifier.
	 * @return string|null Full namespace class path or null if missing.
	 */
	public static function get_provider_class( $slug ) {
		return isset( self::$registry[ $slug ] ) ? self::$registry[ $slug ] : null;
	}

	/**
	 * Registers a new custom provider class path.
	 *
	 * @param string $slug       Provider slug identifier.
	 * @param string $class_path Full namespace class path.
	 */
	public static function register_provider( $slug, $class_path ) {
		self::$registry[ $slug ] = $class_path;
	}

	/**
	 * Retrieves all registered provider slugs.
	 *
	 * @return array Slugs array.
	 */
	public static function get_registered_slugs() {
		return array_keys( self::$registry );
	}
}
