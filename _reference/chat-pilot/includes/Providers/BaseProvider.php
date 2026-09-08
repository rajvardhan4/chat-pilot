<?php
namespace ChatPilot\Providers;

// Prevent direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class BaseProvider
 * Abstract helper adapter implementing shared methods across concrete providers.
 */
abstract class BaseProvider implements ProviderInterface {

	/**
	 * Active driver status.
	 *
	 * @var string
	 */
	protected $status = 'disconnected';

	/**
	 * Tracks connection error count.
	 *
	 * @var int
	 */
	protected $error_count = 0;

	/**
	 * Retrieves the current tracking status code of the driver.
	 *
	 * @return string Current driver status.
	 */
	public function getStatus() {
		return $this->status;
	}

	/**
	 * Sets the adapter status.
	 *
	 * @param string $status Target status string.
	 */
	public function setStatus( $status ) {
		$this->status = $status;
	}

	/**
	 * Wraps remote request operations inside WordPress, tracking response latency and error tags.
	 *
	 * @param string $url     Endpoint URL.
	 * @param array  $args    WP HTTP Client request arguments.
	 * @return array Response map containing latency and body output.
	 */
	protected function make_api_request( $url, $args = array() ) {
		$defaults = array(
			'timeout'     => 15,
			'redirection' => 5,
			'httpversion' => '1.1',
			'user-agent'  => 'ChatPilot/' . CHAT_PILOT_VERSION . '; ' . get_bloginfo( 'url' ),
		);

		$args = wp_parse_args( $args, $defaults );

		$start_time = microtime( true );
		$response   = wp_remote_request( $url, $args );
		$end_time   = microtime( true );
		$latency    = round( ( $end_time - $start_time ) * 1000, 2 ); // Latency in milliseconds.

		if ( is_wp_error( $response ) ) {
			return array(
				'success' => false,
				'latency' => $latency,
				'message' => $response->get_error_message(),
				'code'    => 'network_error',
				'headers' => array(),
			);
		}

		$status_code = wp_remote_retrieve_response_code( $response );
		$body        = wp_remote_retrieve_body( $response );
		$headers     = wp_remote_retrieve_headers( $response );

		return array(
			'success' => $status_code >= 200 && $status_code < 300,
			'latency' => $latency,
			'code'    => $status_code,
			'body'    => $body,
			'headers' => $headers,
		);
	}
}
