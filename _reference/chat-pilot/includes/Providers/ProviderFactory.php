<?php
namespace ChatPilot\Providers;

// Prevent direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class ProviderFactory
 * Factory class for instantiating provider driver adapters dynamically.
 */
class ProviderFactory {

	/**
	 * Creates an instance of a provider adapter class.
	 *
	 * @param string $slug Provider slug identifier.
	 * @return ProviderInterface|null Configured adapter instance, or null.
	 */
	public static function create( $slug ) {
		$class_name = ProviderRegistry::get_provider_class( $slug );

		if ( ! $class_name || ! class_exists( $class_name ) ) {
			return null;
		}

		return new $class_name();
	}
}
