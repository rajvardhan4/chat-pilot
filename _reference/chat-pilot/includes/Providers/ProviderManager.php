<?php
namespace ChatPilot\Providers;

// Prevent direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class ProviderManager
 * Coordinator manager for configurations lookup and testing connections.
 */
class ProviderManager {

	/**
	 * Cached provider driver instances.
	 *
	 * @var array
	 */
	private $instances = array();

	/**
	 * Retrieves an instantiated driver.
	 *
	 * @param string $slug Provider driver identifier.
	 * @return ProviderInterface|null Driver class or null.
	 */
	public function get_provider( $slug ) {
		if ( ! isset( $this->instances[ $slug ] ) ) {
			$instance = ProviderFactory::create( $slug );
			if ( $instance ) {
				$this->instances[ $slug ] = $instance;
			} else {
				return null;
			}
		}
		return $this->instances[ $slug ];
	}

	/**
	 * Returns descriptive information lists for all registered providers.
	 *
	 * @return array Multi-dimensional information lists.
	 */
	public function get_available_providers() {
		$slugs      = ProviderRegistry::get_registered_slugs();
		$info_lists = array();

		foreach ( $slugs as $slug ) {
			$driver = $this->get_provider( $slug );
			if ( $driver ) {
				$info = $driver->getProviderInformation();
				
				// Fetch current database metadata values.
				$settings = \ChatPilot\Core\Plugin::instance()->settings;
				$info['enabled'] = $settings->get( "providers.{$slug}.enabled", false );
				
				$api_key        = $settings->get( "providers.{$slug}.api_key", '' );
				$current_status = $settings->get( "providers.{$slug}.status", 'Not Configured' );

				if ( empty( $api_key ) ) {
					$info['status']        = 'Not Configured';
					$info['enabled']       = false;
					$info['is_configured'] = false;
				} else {
					$info['is_configured'] = true;
					if ( 'Connected' === $current_status && $info['enabled'] ) {
						$info['status'] = 'Connected';
					} elseif ( 'Connected' === $current_status ) {
						$info['status'] = 'Configured';
					} elseif ( ! empty( $current_status ) && 'disconnected' !== $current_status && 'Not Configured' !== $current_status ) {
						$info['status'] = $current_status;
					} else {
						$info['status'] = 'Not Yet Verified';
					}
				}

				$info['api_key']       = $api_key;
				$info['default_model'] = $settings->get( "providers.{$slug}.default_model", '' );
				$info['models']        = $settings->get( "providers.{$slug}.models", array() );
				$info['last_success']  = $settings->get( "providers.{$slug}.last_success", '' );
				$info['last_failure']  = $settings->get( "providers.{$slug}.last_failure", '' );
				$info['response_time'] = $settings->get( "providers.{$slug}.response_time", 0.0 );
				$info['error_count']   = $settings->get( "providers.{$slug}.error_count", 0 );
				
				$info_lists[ $slug ] = $info;
			}
		}

		return $info_lists;
	}

	/**
	 * Tests connection, logs details in custom logs table, and saves metrics.
	 *
	 * @param string $slug   Provider driver identifier.
	 * @param array  $config Connection configuration array.
	 * @return array Verification results.
	 */
	public function test_connection( $slug, array $config ) {
		$driver = $this->get_provider( $slug );
		if ( ! $driver ) {
			return array(
				'success' => false,
				'message' => esc_html__( 'Invalid provider driver.', 'chat-pilot' ),
			);
		}

		$response = $driver->testConnection( $config );
		$settings = \ChatPilot\Core\Plugin::instance()->settings;
		$timestamp = current_time( 'mysql' );

		if ( $response['success'] ) {
			// Update status metadata parameters.
			$settings->set( "providers.{$slug}.status", 'Connected' );
			$settings->set( "providers.{$slug}.last_success", $timestamp );
			$settings->set( "providers.{$slug}.response_time", $response['latency'] );
			$settings->set( "providers.{$slug}.error_count", 0 );
			$settings->save();

			// Reset operational health state to operational to clear any previous warning banner
			update_option( 'chat_pilot_provider_health_' . $slug, array(
				'status'    => 'operational',
				'label'     => 'Operational',
				'provider'  => $slug,
				'timestamp' => $timestamp,
			) );

			// Log success.
			\ChatPilot\Common\Logger::log(
				'info',
				sprintf( 'API Connection Test succeeded for provider %s. Latency: %sms.', esc_html( $slug ), esc_html( $response['latency'] ) )
			);

			// Automatically run dynamic model discovery.
			$models = $driver->fetchAvailableModels( $config );
			if ( ! empty( $models ) ) {
				$settings->set( "providers.{$slug}.models", $models );
				
				// Set default model if empty, set to a non-standard preview model, or not in the available models list.
				$current_default = $settings->get( "providers.{$slug}.default_model", '' );
				$is_non_standard = ( strpos( $current_default, 'antigravity' ) !== false || strpos( $current_default, 'deep-research' ) !== false );
				if ( empty( $current_default ) || $is_non_standard || ! in_array( $current_default, $models, true ) ) {
					$best_model = $this->determine_best_default_model( $slug, $models );
					$settings->set( "providers.{$slug}.default_model", $best_model );
				}
				
				$settings->save();
			}
		} else {
			// Update status error parameters.
			$error_count = (int) $settings->get( "providers.{$slug}.error_count", 0 ) + 1;
			
			// Map HTTP response code to precise lifecycle status.
			$code = isset( $response['code'] ) ? intval( $response['code'] ) : 0;
			$status = 'Connection Failed';
			if ( 401 === $code || 403 === $code ) {
				$status = 'Authentication Failed';
			} elseif ( 429 === $code ) {
				$status = 'Rate Limited';
			} elseif ( $code >= 500 ) {
				$status = 'API Unavailable';
			}

			$settings->set( "providers.{$slug}.status", $status );
			$settings->set( "providers.{$slug}.last_failure", $timestamp );
			$settings->set( "providers.{$slug}.error_count", $error_count );
			$settings->save();

			// Log failure.
			\ChatPilot\Common\Logger::log(
				'error',
				sprintf( 'API Connection Test failed for provider %s. Status: %s. Error: %s.', esc_html( $slug ), esc_html( $status ), esc_html( $response['message'] ) )
			);
		}

		return $response;
	}

	/**
	 * Discovers available models list and updates options tree cache.
	 *
	 * @param string $slug Provider driver identifier.
	 * @return array List of dynamic models discovered.
	 */
	public function refresh_models( $slug ) {
		$driver = $this->get_provider( $slug );
		if ( ! $driver ) {
			return array();
		}

		$settings = \ChatPilot\Core\Plugin::instance()->settings;
		$config   = array(
			'api_key'  => $settings->get( "providers.{$slug}.api_key", '' ),
			'base_url' => $settings->get( "providers.{$slug}.base_url", '' ),
			'org_id'   => $settings->get( "providers.{$slug}.org_id", '' ),
		);

		$models = $driver->fetchAvailableModels( $config );

		if ( ! empty( $models ) ) {
			$settings->set( "providers.{$slug}.models", $models );
			
			// Ensure preferred default model is still valid.
			$current_default = $settings->get( "providers.{$slug}.default_model", '' );
			$is_non_standard = ( strpos( $current_default, 'antigravity' ) !== false || strpos( $current_default, 'deep-research' ) !== false );
			if ( empty( $current_default ) || $is_non_standard || ! in_array( $current_default, $models, true ) ) {
				$best_model = $this->determine_best_default_model( $slug, $models );
				$settings->set( "providers.{$slug}.default_model", $best_model );
			}

			$settings->save();

			// Log models update.
			\ChatPilot\Common\Logger::log(
				'info',
				sprintf( 'Discovered and refreshed %s models list for provider %s.', count( $models ), esc_html( $slug ) )
			);
		}

		return $models;
	}

	/**
	 * Scans discovered models to select the most stable and compatible default model for text completions.
	 *
	 * @param string $slug   Provider slug.
	 * @param array  $models Discovered models list.
	 * @return string Selected best default model identifier.
	 */
	private function determine_best_default_model( $slug, array $models ) {
		if ( empty( $models ) ) {
			return '';
		}

		$priority = array();
		if ( 'openai' === $slug ) {
			$priority = array(
				'gpt-4o-mini',
				'gpt-4o',
				'gpt-4-turbo',
				'gpt-3.5-turbo',
			);
		} elseif ( 'gemini' === $slug ) {
			$priority = array(
				'gemini-3.6-flash',
				'gemini-3.5-flash',
				'gemini-3.5-flash-lite',
				'gemini-flash-latest',
				'gemini-pro-latest',
			);
		}

		foreach ( $priority as $pref ) {
			if ( in_array( $pref, $models, true ) ) {
				return $pref;
			}
		}

		// Fallback: search for first model not containing agentic/interactions prefixes.
		foreach ( $models as $model ) {
			if ( strpos( $model, 'antigravity' ) === false && strpos( $model, 'deep-research' ) === false ) {
				return $model;
			}
		}

		return $models[0];
	}
}
