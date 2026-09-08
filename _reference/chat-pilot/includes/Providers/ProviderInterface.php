<?php
namespace ChatPilot\Providers;

// Prevent direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Interface ProviderInterface
 * Standard contract for all AI connection drivers.
 */
interface ProviderInterface {

	/**
	 * Initializes the connection adapter.
	 *
	 * @param array $config Connection configurations map.
	 * @return bool True if connected.
	 */
	public function connect( array $config );

	/**
	 * Terminate any active sessions.
	 *
	 * @return bool True on success.
	 */
	public function disconnect();

	/**
	 * Audits configuration keys before submitting to remote API.
	 *
	 * @param array $config Configuration credentials list.
	 * @return array Verification results. Array must return 'success' (bool) and optional 'message' (string).
	 */
	public function validateConfiguration( array $config );

	/**
	 * Sends a lightweight check query to test API key validation status.
	 *
	 * @param array $config Configuration credentials list.
	 * @return array Verification results. Array must return 'success' (bool) and optional 'message' (string).
	 */
	public function testConnection( array $config );

	/**
	 * Queries available models list dynamically from the remote API endpoint.
	 *
	 * @param array $config Configuration credentials list.
	 * @return array List of model name string elements.
	 */
	public function fetchAvailableModels( array $config );

	/**
	 * Retrieves metadata descriptions, icons, and information of the driver.
	 *
	 * @return array Provider info properties.
	 */
	public function getProviderInformation();

	/**
	 * Retrieves the current tracking status code of the driver.
	 *
	 * @return string Current driver status (e.g. connected, disconnected, error).
	 */
	public function getStatus();
}
