<?php
namespace ChatPilot\KB;

// Prevent direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class IntelligenceEngine
 * The central cognitive processing layer for Chat Pilot.
 * Manages intent analysis, context assembly, memory, prompt formatting, and AI provider integration.
 */
class IntelligenceEngine {

	/**
	 * Retrieval Engine instance.
	 *
	 * @var RetrievalEngine
	 */
	private $retrieval_engine;

	/**
	 * Constructor.
	 */
	public function __construct() {
		$this->retrieval_engine = new RetrievalEngine();
	}

	/**
	 * Generates conversational AI response using RAG context pipeline.
	 *
	 * @param string $query   Visitor prompt message.
	 * @param array  $history Multi-turn conversation history.
	 * @return array Response payload containing text content and metrics.
	 */
	/**
	 * Classifies incoming user message intent.
	 *
	 * @param string $query User query prompt.
	 * @return string Intent name ('greeting', 'small_talk', 'knowledge').
	 */
	public function classify_intent( $query ) {
		$q = trim( strtolower( $query ) );
		
		// 1. Check Greetings
		if ( preg_match( '/\b(hi|hello|hey|greetings|yo|howdy|whats\s+up|what\'s\s+up|good\s+morning|good\s+afternoon|good\s+evening)\b/i', $q ) ) {
			return 'greeting';
		}
		
		// 2. Check Small Talk
		if ( preg_match( '/\b(how\s+are\s+you|who\s+are\s+you|your\s+name|are\s+you\s+a\s+bot|are\s+you\s+human|what\s+are\s+you|thank\s+you|thanks|bye|goodbye|see\s+you)\b/i', $q ) ) {
			return 'small_talk';
		}

		// 3. Check Chatbot Software Developer Question
		if ( preg_match( '/\b(who\s+(developed|created|built|made|programmed)|developer\s+of|creator\s+of)\s+(chat\s*pilot|this\s+chatbot|this\s+bot|the\s+chatbot|this\s+chat\s+pilot)\b/i', $q ) || preg_match( '/\bwho\s+(developed|created|built|made)\s+chat\s*pilot\b/i', $q ) ) {
			return 'developer_info';
		}
		
		return 'knowledge';
	}

	public function generate_response( $query, array $history = array(), $regenerate = false, array $last_documents = array() ) {
		$start_time = microtime( true );
		$plugin     = \ChatPilot\Core\Plugin::instance();

		$provider_slug = $plugin->settings->get( 'default_provider', $plugin->settings->get( 'ai_defaults.default_provider', 'gemini' ) );
		if ( empty( $provider_slug ) ) {
			$provider_slug = 'gemini';
		}
		$model = $plugin->settings->get( 'default_model', $plugin->settings->get( 'ai_defaults.default_model', 'gemini-3.6-flash' ) );
		if ( empty( $model ) || in_array( $model, array( 'gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash-exp' ), true ) ) {
			$model = 'gemini-3.6-flash';
		}

		$api_key = $plugin->settings->get( "providers.{$provider_slug}.api_key", '' );
		if ( empty( $api_key ) ) {
			$api_key = $plugin->settings->get( "api_keys.{$provider_slug}", '' );
		}
		if ( empty( $api_key ) ) {
			$raw_settings = get_option( 'chat_pilot_options', get_option( 'chat_pilot_settings', array() ) );
			if ( isset( $raw_settings['providers'][ $provider_slug ]['api_key'] ) && ! empty( $raw_settings['providers'][ $provider_slug ]['api_key'] ) ) {
				$api_key = $raw_settings['providers'][ $provider_slug ]['api_key'];
			} elseif ( isset( $raw_settings['api_keys'][ $provider_slug ] ) ) {
				$api_key = $raw_settings['api_keys'][ $provider_slug ];
			}
		}

		$fallback_msg = trim( (string) $plugin->settings->get( 'ai_instructions.fallback_response', '' ) );
		if ( empty( $fallback_msg ) ) {
			$fallback_msg = trim( (string) $plugin->settings->get( 'kb.fallback_message', '' ) );
		}
		if ( empty( $fallback_msg ) ) {
			$fallback_msg = trim( (string) $plugin->settings->get( 'fallback_response', '' ) );
		}
		if ( empty( $fallback_msg ) ) {
			$fallback_msg = "I'm sorry, but I couldn't find that information in the available knowledge. Please contact our team for assistance.";
		}

		$intent      = $this->classify_intent( $query );
		$threshold   = floatval( $plugin->settings->get( 'knowledge_base.retrieval_threshold', 3.0 ) );

		// Custom recovery response based on query intent if anything fails or falls back
		$recovery_text = $fallback_msg;
		if ( 'greeting' === $intent ) {
			$recovery_text = $plugin->settings->get( 'widget.welcome_message', 'Hello! How can I help you today?' );
		} elseif ( 'small_talk' === $intent ) {
			$recovery_text = "I am Chat Pilot, your business assistant. How can I help you today?";
		} elseif ( 'developer_info' === $intent ) {
			$latency = round( ( microtime( true ) - $start_time ) * 1000, 2 );
			return array(
				'success'   => true,
				'text'      => 'Chat Pilot is an AI chatbot developed by Local Marketing Geeks.',
				'documents' => array(),
				'metrics'   => array(
					'provider'          => $provider_slug,
					'model'             => $model,
					'latency'           => $latency,
					'tokens'            => 0,
					'input_tokens'      => 0,
					'output_tokens'     => 0,
					'status'            => 'success',
					'is_provider_error' => false,
					'http_code'         => 200,
				),
				'debug'     => array(
					'intent'            => 'developer_info',
					'sources_used'      => 'None',
					'retrieved_sources' => array( 'faq' => false, 'manual' => false, 'file' => false, 'website' => false ),
					'selected_source'   => 'none',
					'source_type'       => 'none',
					'similarity_score'  => 0,
					'threshold'         => $threshold,
					'confidence_status' => 'developer_credit',
					'provider'          => $provider_slug,
					'model'             => $model,
					'latency'           => $latency,
					'tokens'            => 0,
				),
			);
		}

		$best_score  = 0.0;
		$best_source = 'none';
		$documents   = array();

		$contextual_query = $query;
		if ( ! empty( $history ) && ! $regenerate ) {
			$contextual_query = $this->resolve_contextual_query_heuristic( $query, $history );
		}

		if ( $regenerate ) {
			// Reuse context/documents passed from the client cache
			$documents = $last_documents;
			if ( ! empty( $documents ) ) {
				// Recompute best diagnostics from cached documents
				$best_score  = isset( $documents[0]['relevance_score'] ) ? floatval( $documents[0]['relevance_score'] ) : 0.0;
				$best_source = isset( $documents[0]['source_type'] ) ? $documents[0]['source_type'] : 'none';
			}
		} else {
			if ( 'knowledge' === $intent ) {
				// Search Knowledge Base (RAG Ingestion Pool) using contextual query
				$all_docs = $this->retrieval_engine->search( $contextual_query, 5, true );
				if ( empty( $all_docs ) && $contextual_query !== $query ) {
					// Fallback search with raw query if contextual query returned empty
					$all_docs = $this->retrieval_engine->search( $query, 5, true );
				}
				if ( ! empty( $all_docs ) ) {
					$best_score  = floatval( $all_docs[0]['relevance_score'] );
					$best_source = $all_docs[0]['source_type'];
				}
				// Enforce threshold check manually
				foreach ( $all_docs as $doc ) {
					if ( $doc['relevance_score'] >= $threshold ) {
						$documents[] = $doc;
					}
				}
				// Special multi-turn fallback guard: ONLY if a contextual topic was resolved AND the best score is genuinely relevant (>= 2.0)
				if ( empty( $documents ) && ! empty( $all_docs ) && ! empty( $history ) && $contextual_query !== $query && $best_score >= 2.0 ) {
					$documents = array_slice( $all_docs, 0, 3 );
				}
			}
		}

		// Calculate Match Confidence Status
		$confidence_status = 'none';
		if ( 'knowledge' === $intent ) {
			if ( empty( $documents ) ) {
				$confidence_status = 'Fallback';
			} elseif ( $best_score >= 7.0 ) {
				$confidence_status = 'Excellent Match';
			} elseif ( $best_score >= 4.0 ) {
				$confidence_status = 'Good Match';
			} else {
				$confidence_status = 'Weak Match';
			}
		}

		// 2. Fallback check: Return missing-knowledge fallback whenever zero relevant documents match
		if ( empty( $documents ) && 'knowledge' === $intent ) {
			$latency = round( ( microtime( true ) - $start_time ) * 1000, 2 );
			$this->log_transaction( $provider_slug ? $provider_slug : 'none', $model ? $model : 'none', 0, 0, $latency, 'Low confidence query - Fallback returned', $query );

			return array(
				'success' => true,
				'text'    => $recovery_text,
				'documents' => array(),
				'metrics' => array(
					'provider'      => $provider_slug ? $provider_slug : 'none',
					'model'         => $model ? $model : 'none',
					'latency'       => $latency,
					'tokens'        => 0,
					'status'        => 'fallback_low_confidence',
				),
				'debug' => array(
					'intent'           => 'Fallback',
					'sources_used'     => 'None',
					'retrieved_sources'=> array( 'faq' => false, 'manual' => false, 'file' => false, 'website' => false ),
					'selected_source'  => 'none',
					'source_type'      => $best_source,
					'similarity_score' => $best_score,
					'threshold'        => $threshold,
					'confidence_status'=> 'Fallback',
					'provider'         => $provider_slug ? $provider_slug : 'none',
					'model'            => $model ? $model : 'none',
					'latency'          => $latency,
					'tokens'           => 0,
					'prompt_size'      => 0,
					'completion_size'  => strlen( $recovery_text ),
					'context_size'     => 0,
					'raw_prompt'       => '',
				),
			);
		}

		// 3. Load and check active provider settings
		if ( empty( $provider_slug ) ) {
			$latency = round( ( microtime( true ) - $start_time ) * 1000, 2 );
			return array(
				'success' => true,
				'text'    => $recovery_text,
				'documents' => array(),
				'metrics' => array(
					'provider'          => 'none',
					'model'             => 'none',
					'latency'           => $latency,
					'tokens'            => 0,
					'input_tokens'      => 0,
					'output_tokens'     => 0,
					'status'            => 'error',
					'is_provider_error' => true,
					'error'             => 'No active AI Provider configured.',
					'error_type'        => 'configuration_error',
					'error_label'       => 'No Provider Configured',
					'http_code'         => 0,
				),
				'debug' => array(
					'intent'            => $intent,
					'sources_used'      => 'None',
					'retrieved_sources' => array( 'faq' => false, 'manual' => false, 'file' => false, 'website' => false ),
					'selected_source'   => 'none',
					'source_type'       => $best_source,
					'similarity_score'  => $best_score,
					'threshold'         => $threshold,
					'confidence_status' => $confidence_status,
					'provider'          => 'none',
					'model'             => 'none',
					'latency'           => $latency,
					'tokens'            => 0,
					'prompt_size'       => 0,
					'completion_size'   => strlen( $recovery_text ),
					'context_size'      => 0,
					'raw_prompt'        => '',
					'is_provider_error' => true,
					'error'             => 'No active AI Provider configured.',
					'error_type'        => 'configuration_error',
					'error_label'       => 'No Provider Configured',
					'http_code'         => 0,
					'timestamp'         => current_time( 'mysql' ),
				),
			);
		}

		// 4. Fetch driver connection instance
		$driver = $plugin->providers->get_provider( $provider_slug );
		if ( empty( $api_key ) ) {
			$api_key = $plugin->settings->get( "providers.{$provider_slug}.api_key", '' );
		}
		if ( empty( $api_key ) ) {
			$api_key = $plugin->settings->get( "api_keys.{$provider_slug}", '' );
		}
		if ( empty( $api_key ) ) {
			$raw_settings = get_option( 'chat_pilot_options', get_option( 'chat_pilot_settings', array() ) );
			if ( isset( $raw_settings['providers'][ $provider_slug ]['api_key'] ) && ! empty( $raw_settings['providers'][ $provider_slug ]['api_key'] ) ) {
				$api_key = $raw_settings['providers'][ $provider_slug ]['api_key'];
			} elseif ( isset( $raw_settings['api_keys'][ $provider_slug ] ) ) {
				$api_key = $raw_settings['api_keys'][ $provider_slug ];
			}
		}

		if ( ! $driver || empty( $api_key ) ) {
			$latency = round( ( microtime( true ) - $start_time ) * 1000, 2 );
			return array(
				'success' => true,
				'text'    => $recovery_text,
				'documents' => array(),
				'metrics' => array(
					'provider'          => $provider_slug,
					'model'             => 'none',
					'latency'           => $latency,
					'tokens'            => 0,
					'input_tokens'      => 0,
					'output_tokens'     => 0,
					'status'            => 'error',
					'is_provider_error' => true,
					'error'             => 'API Key missing for provider ' . esc_html( $provider_slug ),
					'error_type'        => 'authentication_error',
					'error_label'       => 'Authentication / Missing Key',
					'http_code'         => 401,
				),
				'debug' => array(
					'intent'            => $intent,
					'sources_used'      => 'None',
					'retrieved_sources' => array( 'faq' => false, 'manual' => false, 'file' => false, 'website' => false ),
					'selected_source'   => 'none',
					'source_type'       => $best_source,
					'similarity_score'  => $best_score,
					'threshold'         => $threshold,
					'confidence_status' => $confidence_status,
					'provider'          => $provider_slug,
					'model'             => 'none',
					'latency'           => $latency,
					'tokens'            => 0,
					'prompt_size'       => 0,
					'completion_size'   => strlen( $recovery_text ),
					'context_size'      => 0,
					'raw_prompt'        => '',
					'is_provider_error' => true,
					'error'             => 'API Key missing for provider ' . esc_html( $provider_slug ),
					'error_type'        => 'authentication_error',
					'error_label'       => 'Authentication / Missing Key',
					'http_code'         => 401,
					'timestamp'         => current_time( 'mysql' ),
				),
			);
		}

		// 5. Context Assembly Engine (Concise context block generation)
		$context_text = '';
		if ( ! empty( $documents ) ) {
			$context_parts = array();
			foreach ( $documents as $doc ) {
				$context_parts[] = sprintf(
					"Source: [%s] (%s)\nTitle: %s\nContent:\n%s",
					$doc['source_type'],
					$doc['source_url'],
					$doc['title'],
					$doc['content']
				);
			}
			$context_text = implode( "\n\n---\n\n", $context_parts );
		}

		// 6. AI Prompt Builder (System prompt formatting & history compilation)
		$system_prompt = $plugin->settings->get( 'ai_instructions.system_prompt', '' );
		if ( empty( $system_prompt ) ) {
			$system_prompt = "You are Chat Pilot, the official AI assistant representing this business. Answer visitor questions politely, concisely, and professionally based ONLY on the retrieved knowledge provided. Never invent pricing, policies, services, or facts not present in the context. If you do not know the answer, respond with the fallback message.";
		}

		// Cleanly enforce Missing Knowledge Fallback Response on irrelevant, wrong, or out-of-scope questions
		$system_prompt = preg_replace(
			'/IRRELEVANT QUESTIONS\s+If a visitor asks something unrelated to .*?Do not invent an answer to an unrelated question\./si',
			"IRRELEVANT QUESTIONS\nIf a visitor asks an irrelevant, wrong, nonsensical, or out-of-scope question (such as math, general trivia, unrelated products, or questions with missing facts), output EXACTLY the Missing Knowledge Fallback Response: \"" . addslashes( $fallback_msg ) . "\". Do not invent alternative explanations.",
			$system_prompt
		);

		if ( ! empty( $history ) ) {
			$system_prompt = str_replace(
				array(
					"If the requested pricing information is unavailable, use the configured fallback response.",
					"If the retrieved knowledge does not contain the answer, return the configured Missing Knowledge Fallback Response.",
					"Fallback Rule: If the answer cannot be found in the context provided below, output exactly:",
					"Fallback Rule: If the answer cannot be found or inferred from the context provided below, output exactly:",
				),
				array(
					"If exact prices or figures are not explicitly listed, explain the service features conversationally and invite them to contact our team for custom quote details.",
					"Synthesize the answer using available context and history. For unlisted specifics, direct the visitor to contact our team.",
					"Instruction: Synthesize answer from context and history. If completely out of scope or answer missing, output fallback: \"" . addslashes( $fallback_msg ) . "\"",
					"Instruction: Synthesize answer from context and history. If completely out of scope or answer missing, output fallback: \"" . addslashes( $fallback_msg ) . "\"",
				),
				$system_prompt
			);
		}

		// Compile conversation history (limit to last 10 messages)
		$history_text = '';
		$limited_history = array_slice( $history, -10 );
		foreach ( $limited_history as $msg ) {
			$role = ( 'user' === strtolower( $msg['role'] ) ) ? 'User' : 'Assistant';
			$history_text .= $role . ': ' . trim( $msg['content'] ) . "\n";
		}

		$visitor_question_display = $query;
		if ( $contextual_query !== $query ) {
			$visitor_question_display = sprintf( "%s (Contextual Topic: %s)", $query, $contextual_query );
		}

		$conversational_guidance = 
			"\n\nCONVERSATIONAL KNOWLEDGE & BUSINESS SCOPE DIRECTIVES:\n" .
			"1. You are Chat Pilot, the official AI business assistant representing this website.\n" .
			"2. ALL business information, service descriptions, program details, pricing, phone numbers, email addresses, physical locations, service areas, and contact methods must be derived EXCLUSIVELY from the Retrieved Knowledge Context.\n" .
			"3. Synthesize answers conversationally, warmly, and accurately using ONLY the context and conversation history.\n" .
			"4. Understand natural follow-up questions ('it', 'that', 'this', 'that one', 'there', 'what age', 'how long', 'how much', 'which one') in relation to prior turns in Conversation History.\n" .
			"5. If a visitor asks how to contact the business, get quotes, or book services, provide ONLY the business contact information (phone, email, address) explicitly present in the Retrieved Knowledge Context. If specific direct contact details are not present in the context, guide them to use the website's contact form or contact page.\n" .
			"6. NEVER invent, synthesize, or include any developer, platform, or external contact numbers, emails, or websites. Under no circumstances should developer support info (such as Local Marketing Geeks contact numbers or emails) be given for business or customer service inquiries.\n" .
			"7. Developer Inquiries: If and ONLY IF a visitor specifically asks who developed, programmed, or built this chatbot software (e.g., 'Who developed Chat Pilot?'), you may state that Chat Pilot was developed by Local Marketing Geeks. Do not mention or attach developer details to any customer service or business answers.\n" .
			"8. If the user asks an irrelevant, wrong, nonsensical, or out-of-scope question (such as math, general trivia, unrelated products, or questions with missing facts), output EXACTLY the fallback response: " . $fallback_msg . "\n" .
			"9. DO NOT output the fallback message if the question is a natural follow-up about a business service or topic already being discussed in conversation history.";

		if ( ! empty( $context_text ) ) {
			$prompt = sprintf(
				"System Instructions:\n%s%s\n\nFallback Rule: If the question is wrong, out of scope, or unrelated to the business, output EXACTLY: %s\n\nRetrieved Knowledge Context:\n%s\n\nConversation History:\n%s\nVisitor Question: %s\n\nAI Response:",
				$system_prompt,
				$conversational_guidance,
				$fallback_msg,
				$context_text,
				$history_text,
				$visitor_question_display
			);
		} else {
			$prompt = sprintf(
				"System Instructions:\n%s%s\n\nFallback Rule: Output EXACTLY: %s\n\nConversation History:\n%s\nVisitor Question: %s\n\nAI Response:",
				$system_prompt,
				$conversational_guidance,
				$fallback_msg,
				$history_text,
				$visitor_question_display
			);
		}

		// 7. Request Completions generation
		$config = array(
			'api_key'       => $api_key,
			'base_url'      => $plugin->settings->get( "providers.{$provider_slug}.base_url", '' ),
			'org_id'        => $plugin->settings->get( "providers.{$provider_slug}.org_id", '' ),
			'default_model' => $model,
		);

		// Admin-authorized simulation hook for deliberate Scenario B provider failure testing
		if ( current_user_can( 'manage_options' ) && ( ! empty( $_POST['simulate_provider_failure'] ) || strpos( $query, '[SIMULATE_QUOTA_ERROR]' ) !== false ) ) {
			$sim_type = ! empty( $_POST['simulate_error_type'] ) ? sanitize_key( $_POST['simulate_error_type'] ) : 'quota_exceeded';
			if ( 'auth_error' === $sim_type ) {
				$response = array(
					'success'      => false,
					'message'      => 'API_KEY_INVALID: Provided API key is invalid or revoked. [HTTP 401]',
					'code'         => 401,
					'error_status' => 'INVALID_ARGUMENT',
					'retry_after'  => '',
					'latency'      => 120,
				);
			} else {
				$response = array(
					'success'      => false,
					'message'      => 'Resource has been exhausted (e.g. check quota). [HTTP 429]',
					'code'         => 429,
					'error_status' => 'RESOURCE_EXHAUSTED',
					'retry_after'  => '60s',
					'latency'      => 345,
				);
			}
		} else {
			$response = $driver->sendPrompt( $config, $prompt );
		}
		$latency  = round( ( microtime( true ) - $start_time ) * 1000, 2 );

		if ( ! empty( $response['model'] ) ) {
			$model = $response['model'];
		}

		// Map Source checklist and Used description summary
		$types_checked = array( 'faq' => false, 'manual' => false, 'file' => false, 'website' => false );
		$types_active  = array();
		foreach ( $documents as $d ) {
			$t = $d['source_type'];
			if ( isset( $types_checked[$t] ) ) {
				$types_checked[$t] = true;
				$types_active[] = strtoupper( $t );
			}
		}
		$types_active = array_unique( $types_active );

		$sources_used = 'None';
		if ( ! empty( $types_active ) ) {
			if ( count( $types_active ) === 1 ) {
				if ( $types_active[0] === 'FAQ' ) {
					$sources_used = 'Only FAQ';
				} elseif ( $types_active[0] === 'WEBSITE' ) {
					$sources_used = 'Website';
				} else {
					$sources_used = $types_active[0];
				}
			} elseif ( count( $types_active ) === 2 && in_array( 'FAQ', $types_active ) && in_array( 'WEBSITE', $types_active ) ) {
				$sources_used = 'Both';
			} else {
				$sources_used = implode( ' + ', $types_active );
			}
		}

		if ( empty( $response['success'] ) || empty( $response['text'] ) ) {
			$err_msg     = ! empty( $response['message'] ) ? $response['message'] : 'AI Provider generation failed.';
			$http_code   = isset( $response['code'] ) ? intval( $response['code'] ) : ( isset( $response['http_code'] ) ? intval( $response['http_code'] ) : 0 );
			$retry_after = isset( $response['retry_after'] ) ? sanitize_text_field( $response['retry_after'] ) : '';

			// Categorize error type
			$err_lower = strtolower( $err_msg . ' ' . ( isset( $response['error_status'] ) ? $response['error_status'] : '' ) . ' ' . ( isset( $response['error_type'] ) ? $response['error_type'] : '' ) . ' ' . $http_code );

			if ( 429 === $http_code || strpos( $err_lower, '429' ) !== false || strpos( $err_lower, 'quota' ) !== false || strpos( $err_lower, 'resource_exhausted' ) !== false || strpos( $err_lower, 'rate limit' ) !== false || strpos( $err_lower, 'rate_limit' ) !== false || strpos( $err_lower, 'insufficient_quota' ) !== false ) {
				$error_category       = 'quota_exceeded';
				$error_category_label = 'Quota / Rate Limit Exceeded';
			} elseif ( in_array( $http_code, array( 401, 403 ), true ) || strpos( $err_lower, 'invalid api key' ) !== false || strpos( $err_lower, 'api_key_invalid' ) !== false || strpos( $err_lower, 'unauthorized' ) !== false || strpos( $err_lower, 'key missing' ) !== false ) {
				$error_category       = 'authentication_error';
				$error_category_label = 'Authentication / Invalid Key';
			} elseif ( strpos( $err_lower, 'timeout' ) !== false || strpos( $err_lower, 'timed out' ) !== false || 'network_error' === $http_code ) {
				$error_category       = 'timeout_error';
				$error_category_label = 'Timeout / Network Error';
			} else {
				$error_category       = 'provider_error';
				$error_category_label = 'AI Provider Error';
			}

			// Ensure API key or endpoint URLs are never exposed in logs or diagnostics
			if ( ! empty( $api_key ) ) {
				$err_msg = str_replace( $api_key, '***', $err_msg );
			}
			$err_msg = preg_replace( '/key=([a-zA-Z0-9_\-]+)/', 'key=***', $err_msg );

			// Update provider operational health state
			$health_data = array(
				'status'        => $error_category,
				'label'         => $error_category_label,
				'message'       => $err_msg,
				'http_code'     => $http_code,
				'retry_after'   => $retry_after,
				'provider'      => $provider_slug,
				'model'         => $model,
				'timestamp'     => current_time( 'mysql' ),
			);
			update_option( 'chat_pilot_provider_health_' . $provider_slug, $health_data );

			// Trigger admin notification email with throttling
			$notif_mgr = new \ChatPilot\Notifications\NotificationManager();
			$notif_mgr->trigger_provider_failure_notification( $health_data );

			// Log transaction with is_error = true
			$this->log_transaction( $provider_slug, $model, strlen( $prompt ), 0, $latency, $error_category_label . ': ' . $err_msg, $query, true );

			// Custom error recovery response for visitor
			$recovery_text = "I'm having trouble generating a response right now. Please try again in a moment.";
			if ( 'greeting' === $intent ) {
				$recovery_text = $plugin->settings->get( 'widget.welcome_message', 'Hello! How can I help you today?' );
			} elseif ( 'small_talk' === $intent ) {
				$recovery_text = "I am Chat Pilot, your business assistant. How can I help you today?";
			}

			return array(
				'success' => true,
				'text'    => $recovery_text,
				'documents' => $documents,
				'metrics' => array(
					'provider'          => $provider_slug,
					'model'             => $model,
					'latency'           => $latency,
					'tokens'            => 0,
					'input_tokens'      => 0,
					'output_tokens'     => 0,
					'status'            => 'error',
					'is_provider_error' => true,
					'error'             => $err_msg,
					'error_type'        => $error_category,
					'error_label'       => $error_category_label,
					'http_code'         => $http_code,
					'retry_after'       => $retry_after,
				),
				'debug' => array(
					'intent'            => $intent,
					'sources_used'      => $sources_used,
					'retrieved_sources' => $types_checked,
					'selected_source'   => $best_source,
					'source_type'       => $best_source,
					'similarity_score'  => $best_score,
					'threshold'         => $threshold,
					'confidence_status' => $confidence_status,
					'provider'          => $provider_slug,
					'model'             => $model,
					'latency'           => $latency,
					'tokens'            => 0,
					'prompt_size'       => strlen( $prompt ),
					'completion_size'   => strlen( $recovery_text ),
					'context_size'      => strlen( $context_text ),
					'raw_prompt'        => $prompt,
					'is_provider_error' => true,
					'error'             => $err_msg,
					'error_type'        => $error_category,
					'error_label'       => $error_category_label,
					'http_code'         => $http_code,
					'retry_after'       => $retry_after,
					'timestamp'         => current_time( 'mysql' ),
				),
			);
		}

		$ai_text       = trim( $response['text'] );
		// Catch any guardrail redirection or out-of-scope response and normalize to configured fallback message
		if ( strpos( strtolower( $ai_text ), 'i can only assist with questions related to' ) !== false || strpos( strtolower( $ai_text ), 'only assist with questions related to' ) !== false ) {
			$ai_text = $fallback_msg;
		}

		// Architectural Domain Isolation: Guarantee developer support contact info never leaks into client business answers
		$is_developer_query = preg_match( '/\b(who\s+(developed|created|built|made|programmed)|developer|creator)\b/i', $query );
		if ( ! $is_developer_query ) {
			// Strip developer support phone and email if ever present
			$ai_text = str_ireplace( array( '888-299-2726', 'info@localmarketinggeeks.com' ), array( '', '' ), $ai_text );
			// Clean up any formatting artifacts left by stripping
			$ai_text = preg_replace( '/\s*,\s*,\s*/', ', ', $ai_text );
			$ai_text = preg_replace( '/\bat\s*,/i', 'at', $ai_text );
			$ai_text = preg_replace( '/\bor\s*,\s*/i', '', $ai_text );
			$ai_text = preg_replace( '/\s{2,}/', ' ', $ai_text );
			$ai_text = trim( $ai_text );
		}
		$input_tokens  = isset( $response['input_tokens'] ) ? intval( $response['input_tokens'] ) : (int) ceil( strlen( $prompt ) / 4 );
		$output_tokens = isset( $response['output_tokens'] ) ? intval( $response['output_tokens'] ) : (int) ceil( strlen( $ai_text ) / 4 );
		$tokens_count  = isset( $response['tokens'] ) ? intval( $response['tokens'] ) : ( $input_tokens + $output_tokens );

		// Update operational health to operational on success
		update_option( 'chat_pilot_provider_health_' . $provider_slug, array(
			'status'    => 'operational',
			'label'     => 'Operational',
			'provider'  => $provider_slug,
			'model'     => $model,
			'timestamp' => current_time( 'mysql' ),
		) );

		$this->log_transaction( $provider_slug, $model, strlen( $prompt ), $tokens_count, $latency, '', $query );

		return array(
			'success'   => true,
			'text'      => $ai_text,
			'documents' => $documents,
			'metrics'   => array(
				'provider'      => $provider_slug,
				'model'         => $model,
				'latency'       => $latency,
				'tokens'        => $tokens_count,
				'input_tokens'  => $input_tokens,
				'output_tokens' => $output_tokens,
				'status'        => 'success',
			),
			'debug' => array(
				'intent'           => $intent,
				'sources_used'     => $sources_used,
				'retrieved_sources'=> $types_checked,
				'selected_source'  => $best_source,
				'source_type'      => $best_source,
				'similarity_score' => $best_score,
				'threshold'        => $threshold,
				'confidence_status'=> $confidence_status,
				'provider'         => $provider_slug,
				'model'            => $model,
				'latency'          => $latency,
				'tokens'           => $tokens_count,
				'input_tokens'     => $input_tokens,
				'output_tokens'    => $output_tokens,
				'prompt_size'      => strlen( $prompt ),
				'completion_size'  => strlen( $ai_text ),
				'context_size'     => strlen( $context_text ),
				'raw_prompt'       => $prompt,
				'raw_response'     => isset( $response['body'] ) ? $response['body'] : ( isset( $response['message'] ) ? $response['message'] : '' ),
				'contextual_query' => $contextual_query,
				'timestamp'        => current_time( 'mysql' ),
			),
		);
	}

	/**
	 * Resolves conversational references (e.g. "which one", "that", "it", "this", "that program", "where", "what age")
	 * in the user's current message against conversation history to produce a standalone search query.
	 *
	 * @param string $query         User question.
	 * @param array  $history       Multi-turn conversation history.
	 * @param string $provider_slug Provider slug.
	 * @param string $model         Model name.
	 * @param object $plugin        Plugin instance.
	 * @return string Rewritten standalone search query.
	 */
	public function resolve_contextual_query( $query, array $history, $provider_slug, $model, $plugin ) {
		if ( empty( $history ) ) {
			return $query;
		}

		$driver  = $plugin->providers->get_provider( $provider_slug );
		$api_key = $plugin->settings->get( "providers.{$provider_slug}.api_key", '' );
		if ( empty( $api_key ) ) {
			$api_key = $plugin->settings->get( "api_keys.{$provider_slug}", '' );
		}
		if ( empty( $api_key ) ) {
			$raw_settings = get_option( 'chat_pilot_options', get_option( 'chat_pilot_settings', array() ) );
			if ( isset( $raw_settings['providers'][ $provider_slug ]['api_key'] ) && ! empty( $raw_settings['providers'][ $provider_slug ]['api_key'] ) ) {
				$api_key = $raw_settings['providers'][ $provider_slug ]['api_key'];
			} elseif ( isset( $raw_settings['api_keys'][ $provider_slug ] ) ) {
				$api_key = $raw_settings['api_keys'][ $provider_slug ];
			}
		}

		if ( ! $driver || empty( $api_key ) ) {
			return $this->resolve_contextual_query_heuristic( $query, $history );
		}

		$history_text = '';
		$limited_history = array_slice( $history, -6 );
		foreach ( $limited_history as $msg ) {
			$role = ( 'user' === strtolower( $msg['role'] ) ) ? 'User' : 'Assistant';
			$history_text .= $role . ': ' . trim( $msg['content'] ) . "\n";
		}

		$resolution_prompt = sprintf(
			"Given the following conversation history between a user and an AI assistant, rewrite the user's latest question into a clear, self-contained search query for knowledge base retrieval.\n\n" .
			"Guidelines:\n" .
			"1. Resolve pronouns and implicit references (such as 'which one', 'that', 'this', 'it', 'there', 'those', 'these', 'that program', 'the one you mentioned', 'where', 'what age') to their specific referent mentioned in prior messages.\n" .
			"2. If the user asks an unrelated question (e.g., 'Who won the FIFA World Cup?'), DO NOT add business or previous topic context. Keep the question exactly as asked.\n" .
			"3. Output ONLY the rewritten standalone search query text without any intro, markdown, quotes, or explanation.\n\n" .
			"Conversation History:\n%s\n" .
			"Latest User Question: %s\n\n" .
			"Rewritten Search Query:",
			$history_text,
			$query
		);

		$config = array(
			'api_key'       => $api_key,
			'base_url'      => $plugin->settings->get( "providers.{$provider_slug}.base_url", '' ),
			'org_id'        => $plugin->settings->get( "providers.{$provider_slug}.org_id", '' ),
			'default_model' => $model,
		);

		$result = $driver->sendPrompt( $config, $resolution_prompt );
		if ( ! empty( $result['success'] ) && ! empty( $result['text'] ) ) {
			$rewritten = trim( str_replace( array( '"', "'", "\n", "\r" ), ' ', $result['text'] ) );
			if ( ! empty( $rewritten ) && strlen( $rewritten ) > 3 && strtolower( $rewritten ) !== strtolower( $query ) ) {
				return $rewritten;
			}
		}

		return $this->resolve_contextual_query_heuristic( $query, $history );
	}

	/**
	 * Heuristic fallback rewriter for multi-turn follow-up queries.
	 * Extracts referent topics from conversation history to resolve pronouns.
	 *
	 * @param string $query   User follow-up prompt.
	 * @param array  $history Multi-turn conversation history.
	 * @return string Rewritten standalone search query.
	 */
	public function resolve_contextual_query_heuristic( $query, array $history ) {
		if ( empty( $history ) ) {
			return $query;
		}

		$q_lower = strtolower( trim( $query ) );

		// Compile past user and assistant message text
		$past_text = '';
		foreach ( array_slice( $history, -4 ) as $msg ) {
			$past_text .= ' ' . strtolower( $msg['content'] );
		}

		// Detect topic from history
		$topic = '';
		if ( strpos( $past_text, 'private' ) !== false || strpos( $past_text, 'one-on-one' ) !== false || strpos( $past_text, 'one on one' ) !== false ) {
			$topic = 'Private Training Sessions';
		} elseif ( strpos( $past_text, 'board' ) !== false || strpos( $past_text, 'boarding' ) !== false ) {
			$topic = 'Board and Train Program';
		} elseif ( strpos( $past_text, 'day training' ) !== false || strpos( $past_text, 'daycare' ) !== false ) {
			$topic = 'Day Training Program';
		} elseif ( strpos( $past_text, 'puppy' ) !== false ) {
			$topic = 'Puppy Socialization and Training';
		} elseif ( strpos( $past_text, 'area' ) !== false || strpos( $past_text, 'serve' ) !== false || strpos( $past_text, 'location' ) !== false ) {
			$topic = 'Service Areas';
		} elseif ( strpos( $past_text, 'service' ) !== false || strpos( $past_text, 'program' ) !== false || strpos( $past_text, 'offer' ) !== false ) {
			$topic = 'Dog Training Programs';
		}

		if ( empty( $topic ) ) {
			return $query;
		}

		// Check for pronoun/reference triggers
		$has_ref = preg_match( '/\b(it|that|this|there|one|which|those|these|they|that one|the one|how long|how much|what age|where|different)\b/i', $q_lower );

		if ( ! $has_ref ) {
			return $query;
		}

		if ( strpos( $q_lower, 'cost' ) !== false || strpos( $q_lower, 'price' ) !== false || strpos( $q_lower, 'how much' ) !== false ) {
			return sprintf( 'How much does %s cost?', $topic );
		}

		if ( strpos( $q_lower, 'long' ) !== false || strpos( $q_lower, 'duration' ) !== false || strpos( $q_lower, 'last' ) !== false ) {
			return sprintf( 'How long does %s last?', $topic );
		}

		if ( strpos( $q_lower, 'age' ) !== false || strpos( $q_lower, 'old' ) !== false ) {
			return sprintf( 'What age range is %s for?', $topic );
		}

		if ( strpos( $q_lower, 'overnight' ) !== false || strpos( $q_lower, 'stay' ) !== false ) {
			return sprintf( 'Which %s does not require an overnight stay?', $topic );
		}

		if ( strpos( $q_lower, 'different' ) !== false || strpos( $q_lower, 'difference' ) !== false ) {
			return sprintf( 'How is %s different from other programs?', $topic );
		}

		if ( strpos( $q_lower, 'there' ) !== false || strpos( $q_lower, 'serve' ) !== false ) {
			return sprintf( 'What are the service areas for %s?', $topic );
		}

		return sprintf( '%s for %s', $query, $topic );
	}

	/**
	 * Logs transaction metrics in custom database logs table.
	 */
	private function log_transaction( $provider, $model, $prompt_size, $tokens, $latency, $error = '', $query = '', $is_error = false ) {
		$plugin = \ChatPilot\Core\Plugin::instance();
		$enable_logging = $plugin->settings->get( 'general.enable_logging', true );

		if ( ! $enable_logging ) {
			return;
		}

		$level   = $is_error ? 'error' : 'info';
		$message = sprintf(
			'AI Ingestion complete. Provider: %s. Model: %s. Latency: %sms. Tokens: %s.',
			esc_html( $provider ),
			esc_html( $model ),
			esc_html( $latency ),
			esc_html( $tokens )
		);

		if ( ! empty( $error ) ) {
			$message .= ' Log Info: ' . esc_html( $error );
		}

		$context = array(
			'provider'     => $provider,
			'model'        => $model,
			'prompt_bytes' => $prompt_size,
			'tokens_used'  => $tokens,
			'latency_ms'   => $latency,
			'query'        => $query,
		);
		\ChatPilot\Common\Logger::log( $level, $message, $context );
	}
}
