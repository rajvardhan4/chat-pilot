<?php
namespace ChatPilot\Providers;

// Prevent direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class GeminiProvider
 * Connector driver for Google Gemini API systems.
 */
class GeminiProvider extends BaseProvider {

	/**
	 * Initializes connection.
	 */
	public function connect( array $config ) {
		$check = $this->validateConfiguration( $config );
		if ( ! $check['success'] ) {
			$this->status = 'error';
			return false;
		}
		$this->status = 'connected';
		return true;
	}

	/**
	 * Disconnects.
	 */
	public function disconnect() {
		$this->status = 'disconnected';
		return true;
	}

	/**
	 * Validates config keys.
	 */
	public function validateConfiguration( array $config ) {
		if ( empty( $config['api_key'] ) ) {
			return array(
				'success' => false,
				'message' => esc_html__( 'Gemini API Key is required.', 'chat-pilot' ),
			);
		}
		return array( 'success' => true );
	}

	/**
	 * Sends lightweight check query to test key.
	 */
	public function testConnection( array $config ) {
		$validate = $this->validateConfiguration( $config );
		if ( ! $validate['success'] ) {
			return $validate;
		}

		$url      = 'https://generativelanguage.googleapis.com/v1beta/models?key=' . rawurlencode( $config['api_key'] );
		$response = $this->make_api_request(
			$url,
			array(
				'method' => 'GET',
			)
		);

		if ( ! $response['success'] ) {
			$this->status = 'error';
			$error_msg    = esc_html__( 'Connection Failed.', 'chat-pilot' );
			if ( isset( $response['body'] ) ) {
				$body_decoded = json_decode( $response['body'], true );
				if ( ! empty( $body_decoded['error']['message'] ) ) {
					$error_msg = $body_decoded['error']['message'];
				}
			} elseif ( ! empty( $response['message'] ) ) {
				$error_msg = $response['message'];
			}

			return array(
				'success' => false,
				'message' => $error_msg,
				'latency' => $response['latency'],
				'code'    => $response['code'],
			);
		}

		$this->status = 'connected';
		return array(
			'success' => true,
			'message' => esc_html__( 'Connected Successfully.', 'chat-pilot' ),
			'latency' => $response['latency'],
		);
	}

	/**
	 * Queries models dynamically.
	 */
	public function fetchAvailableModels( array $config ) {
		$url      = 'https://generativelanguage.googleapis.com/v1beta/models?key=' . rawurlencode( $config['api_key'] );
		$response = $this->make_api_request(
			$url,
			array(
				'method' => 'GET',
			)
		);

		if ( ! $response['success'] || empty( $response['body'] ) ) {
			return array();
		}

		$data = json_decode( $response['body'], true );
		if ( empty( $data['models'] ) || ! is_array( $data['models'] ) ) {
			return array();
		}

		$models = array();
		foreach ( $data['models'] as $model_item ) {
			$name = $model_item['name']; // Format: models/gemini-1.5-pro
			$id   = str_replace( 'models/', '', $name );

			// Filter only generation/completions capability models.
			if ( ! empty( $model_item['supportedGenerationMethods'] ) && in_array( 'generateContent', $model_item['supportedGenerationMethods'], true ) ) {
				// Exclude incompatible / specialized model categories
				$incompatible_patterns = array(
					'antigravity',
					'deep-research',
					'nano-banana',
					'embedding',
					'aqa',
					'imagen',
					'classifier',
					'realtime',
					'audio',
					'tts',
					'speech',
					'whisper',
					'moderation'
				);

				$is_compatible = true;
				foreach ( $incompatible_patterns as $pattern ) {
					if ( strpos( strtolower( $id ), $pattern ) !== false ) {
						$is_compatible = false;
						break;
					}
				}

				$deprecated_models = array(
					'gemini-1.5-flash',
					'gemini-1.5-pro',
					'gemini-2.0-flash',
					'gemini-2.5-flash',
					'gemini-2.5-flash-lite',
					'gemini-2.0-flash-exp',
				);
				if ( in_array( $id, $deprecated_models, true ) ) {
					$is_compatible = false;
				}

				if ( $is_compatible ) {
					$models[] = $id;
				}
			}
		}

		if ( ! in_array( 'gemini-3.6-flash', $models, true ) ) {
			$models[] = 'gemini-3.6-flash';
		}
		if ( ! in_array( 'gemini-3.5-flash', $models, true ) ) {
			$models[] = 'gemini-3.5-flash';
		}
		if ( ! in_array( 'gemini-3.5-flash-lite', $models, true ) ) {
			$models[] = 'gemini-3.5-flash-lite';
		}

		sort( $models );
		return $models;
	}

	/**
	 * Info details.
	 */
	public function getProviderInformation() {
		return array(
			'name'        => 'Google Gemini',
			'slug'        => 'gemini',
			'description' => esc_html__( 'Integrates Gemini models (Gemini 1.5 Pro, Flash) using the Google generative AI API.', 'chat-pilot' ),
			'logo'        => 'gemini-logo-svg',
		);
	}

	/**
	 * Sends completions prompts for playground.
	 */
	public function sendPrompt( array $config, $prompt ) {
		$api_key = ! empty( $config['api_key'] ) ? $config['api_key'] : '';
		$model   = ! empty( $config['default_model'] ) ? trim( $config['default_model'] ) : 'gemini-3.6-flash';
		// Purge all retired / unavailable models to prevent 404 / 503 errors
		if ( in_array( $model, array( 'gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash-exp' ), true ) ) {
			$model = 'gemini-3.6-flash';
		}

		if ( empty( $api_key ) ) {
			return array(
				'success' => false,
				'message' => 'Gemini API Key missing',
				'latency' => 0,
			);
		}

		// Strictly active models available on Google AI Studio
		$candidates = array_unique( array( $model, 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite' ) );

		$headers = array(
			'Content-Type' => 'application/json',
		);

		$payload = array(
			'contents' => array(
				array(
					'parts' => array(
						array(
							'text' => $prompt,
						),
					),
				),
			),
		);

		$response   = array( 'success' => false );
		$last_res   = array();
		$used_model = $model;
		foreach ( $candidates as $m ) {
			$url = 'https://generativelanguage.googleapis.com/v1beta/models/' . rawurlencode( $m ) . ':generateContent?key=' . rawurlencode( $api_key );
			$res = $this->make_api_request(
				$url,
				array(
					'method'  => 'POST',
					'headers' => $headers,
					'body'    => wp_json_encode( $payload ),
					'timeout' => 12,
				)
			);
			$last_res   = $res;
			$used_model = $m;

			if ( ! empty( $res['success'] ) && ! empty( $res['body'] ) ) {
				$body_data = json_decode( $res['body'], true );
				if ( ! empty( $body_data['candidates'][0]['content']['parts'][0]['text'] ) ) {
					$response = $res;
					break;
				}
			}

			// Immediately halt retry loop on quota exhaustion, rate limit, or invalid auth to prevent user lag
			$res_code = isset( $res['code'] ) ? intval( $res['code'] ) : 0;
			if ( 429 === $res_code || 401 === $res_code || 403 === $res_code ) {
				break;
			}
		}

		if ( empty( $response['success'] ) && ! empty( $last_res ) ) {
			$response = $last_res;
		}

		if ( ! $response['success'] ) {
			$error_msg    = esc_html__( 'Request Failed.', 'chat-pilot' );
			$http_code    = isset( $response['code'] ) ? intval( $response['code'] ) : 0;
			$error_status = '';
			$retry_after  = '';

			if ( ! empty( $response['headers'] ) ) {
				if ( isset( $response['headers']['retry-after'] ) ) {
					$retry_after = (string) $response['headers']['retry-after'];
				}
			}

			if ( isset( $response['body'] ) ) {
				$body_decoded = json_decode( $response['body'], true );
				if ( ! empty( $body_decoded['error']['message'] ) ) {
					$error_msg = $body_decoded['error']['message'];
				}
				if ( ! empty( $body_decoded['error']['status'] ) ) {
					$error_status = $body_decoded['error']['status'];
				}
			}

			// Ensure API key is never leaked in the message
			if ( ! empty( $api_key ) ) {
				$error_msg = str_replace( $api_key, '***', $error_msg );
			}
			$error_msg = preg_replace( '/key=([a-zA-Z0-9_\-]+)/', 'key=***', $error_msg );

			return array(
				'success'      => false,
				'message'      => $error_msg,
				'code'         => $http_code,
				'model'        => $used_model,
				'error_status' => $error_status,
				'retry_after'  => $retry_after,
				'latency'      => isset( $response['latency'] ) ? $response['latency'] : 0,
			);
		}

		$data          = json_decode( $response['body'], true );
		$text          = '';
		$input_tokens  = isset( $data['usageMetadata']['promptTokenCount'] ) ? intval( $data['usageMetadata']['promptTokenCount'] ) : 0;
		$output_tokens = isset( $data['usageMetadata']['candidatesTokenCount'] ) ? intval( $data['usageMetadata']['candidatesTokenCount'] ) : 0;
		$total_tokens  = isset( $data['usageMetadata']['totalTokenCount'] ) ? intval( $data['usageMetadata']['totalTokenCount'] ) : ( $input_tokens + $output_tokens );

		if ( ! empty( $data['candidates'][0]['content']['parts'][0]['text'] ) ) {
			$text = trim( $data['candidates'][0]['content']['parts'][0]['text'] );
		}

		if ( 0 === $total_tokens && ! empty( $prompt ) ) {
			$input_tokens  = (int) ceil( mb_strlen( $prompt ) / 4 );
			$output_tokens = (int) ceil( mb_strlen( $text ) / 4 );
			$total_tokens  = $input_tokens + $output_tokens;
		}

		return array(
			'success'       => true,
			'text'          => $text,
			'model'         => $used_model,
			'tokens'        => $total_tokens,
			'input_tokens'  => $input_tokens,
			'output_tokens' => $output_tokens,
			'latency'       => $response['latency'],
		);
	}
}
