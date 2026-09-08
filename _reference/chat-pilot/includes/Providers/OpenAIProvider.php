<?php
namespace ChatPilot\Providers;

// Prevent direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class OpenAIProvider
 * Connector driver for OpenAI API systems.
 */
class OpenAIProvider extends BaseProvider {

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
				'message' => esc_html__( 'OpenAI API Key is required.', 'chat-pilot' ),
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

		$base_url = ! empty( $config['base_url'] ) ? untrailingslashit( $config['base_url'] ) : 'https://api.openai.com/v1';
		$url      = $base_url . '/models';

		$headers = array(
			'Authorization' => 'Bearer ' . $config['api_key'],
		);

		if ( ! empty( $config['org_id'] ) ) {
			$headers['OpenAI-Organization'] = $config['org_id'];
		}

		$response = $this->make_api_request(
			$url,
			array(
				'method'  => 'GET',
				'headers' => $headers,
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
		$base_url = ! empty( $config['base_url'] ) ? untrailingslashit( $config['base_url'] ) : 'https://api.openai.com/v1';
		$url      = $base_url . '/models';

		$headers = array(
			'Authorization' => 'Bearer ' . $config['api_key'],
		);

		if ( ! empty( $config['org_id'] ) ) {
			$headers['OpenAI-Organization'] = $config['org_id'];
		}

		$response = $this->make_api_request(
			$url,
			array(
				'method'  => 'GET',
				'headers' => $headers,
			)
		);

		if ( ! $response['success'] || empty( $response['body'] ) ) {
			return array();
		}

		$data = json_decode( $response['body'], true );
		if ( empty( $data['data'] ) || ! is_array( $data['data'] ) ) {
			return array();
		}

		$models = array();
		foreach ( $data['data'] as $model_item ) {
			$id = $model_item['id'];
			
			// Apply negative blacklist first.
			$incompatible_patterns = array(
				'dall-e',
				'tts-',
				'whisper-',
				'moderation',
				'embed',
				'realtime',
				'audio',
				'similarity',
				'search',
				'edit',
				'insert',
				'babbage',
				'curie',
				'ada'
			);

			$is_compatible = true;
			foreach ( $incompatible_patterns as $pattern ) {
				if ( strpos( strtolower( $id ), $pattern ) !== false ) {
					// Special exception: allow text-davinci-003
					if ( 'davinci' === $pattern && strpos( strtolower( $id ), 'text-davinci' ) !== false ) {
						continue;
					}
					$is_compatible = false;
					break;
				}
			}

			// If it passes blacklist, verify it fits our chat/completions positive heuristics
			if ( $is_compatible ) {
				$is_chat_or_text = false;
				if ( preg_match( '/^(gpt-|o\d|o-|text-davinci)/i', $id ) ) {
					$is_chat_or_text = true;
				} elseif ( strpos( strtolower( $id ), 'chat' ) !== false || strpos( strtolower( $id ), 'completion' ) !== false ) {
					$is_chat_or_text = true;
				}

				if ( $is_chat_or_text ) {
					$models[] = $id;
				}
			}
		}

		// Fallback to all if no chat models matched
		if ( empty( $models ) ) {
			foreach ( $data['data'] as $model_item ) {
				$models[] = $model_item['id'];
			}
		}

		sort( $models );
		return $models;
	}

	/**
	 * Info details.
	 */
	public function getProviderInformation() {
		return array(
			'name'        => 'OpenAI',
			'slug'        => 'openai',
			'description' => esc_html__( 'Integrates OpenAI models (GPT-4o, GPT-4, GPT-3.5, o1) for prompt completions.', 'chat-pilot' ),
			'logo'        => 'openai-logo-svg',
		);
	}

	/**
	 * Sends completions prompts for playground.
	 */
	public function sendPrompt( array $config, $prompt ) {
		$base_url = ! empty( $config['base_url'] ) ? untrailingslashit( $config['base_url'] ) : 'https://api.openai.com/v1';
		$url      = $base_url . '/chat/completions';
		$model    = ! empty( $config['default_model'] ) ? $config['default_model'] : 'gpt-4o';

		$headers = array(
			'Authorization' => 'Bearer ' . $config['api_key'],
			'Content-Type'  => 'application/json',
		);

		if ( ! empty( $config['org_id'] ) ) {
			$headers['OpenAI-Organization'] = $config['org_id'];
		}

		$payload = array(
			'model'    => $model,
			'messages' => array(
				array(
					'role'    => 'user',
					'content' => $prompt,
				),
			),
		);

		$response = $this->make_api_request(
			$url,
			array(
				'method'  => 'POST',
				'headers' => $headers,
				'body'    => wp_json_encode( $payload ),
			)
		);

		if ( ! $response['success'] ) {
			$error_msg   = esc_html__( 'Request Failed.', 'chat-pilot' );
			$http_code   = isset( $response['code'] ) ? intval( $response['code'] ) : 0;
			$error_type  = '';
			$retry_after = '';

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
				if ( ! empty( $body_decoded['error']['type'] ) ) {
					$error_type = $body_decoded['error']['type'];
				}
			}

			if ( ! empty( $config['api_key'] ) ) {
				$error_msg = str_replace( $config['api_key'], '***', $error_msg );
			}

			return array(
				'success'     => false,
				'message'     => $error_msg,
				'code'        => $http_code,
				'error_type'  => $error_type,
				'retry_after' => $retry_after,
				'latency'     => isset( $response['latency'] ) ? $response['latency'] : 0,
			);
		}

		$data          = json_decode( $response['body'], true );
		$text          = isset( $data['choices'][0]['message']['content'] ) ? $data['choices'][0]['message']['content'] : '';
		$input_tokens  = isset( $data['usage']['prompt_tokens'] ) ? intval( $data['usage']['prompt_tokens'] ) : 0;
		$output_tokens = isset( $data['usage']['completion_tokens'] ) ? intval( $data['usage']['completion_tokens'] ) : 0;
		$total_tokens  = isset( $data['usage']['total_tokens'] ) ? intval( $data['usage']['total_tokens'] ) : ( $input_tokens + $output_tokens );

		if ( 0 === $total_tokens && ! empty( $prompt ) ) {
			$input_tokens  = (int) ceil( mb_strlen( $prompt ) / 4 );
			$output_tokens = (int) ceil( mb_strlen( $text ) / 4 );
			$total_tokens  = $input_tokens + $output_tokens;
		}

		return array(
			'success'       => true,
			'text'          => $text,
			'tokens'        => $total_tokens,
			'input_tokens'  => $input_tokens,
			'output_tokens' => $output_tokens,
			'latency'       => $response['latency'],
		);
	}
}
