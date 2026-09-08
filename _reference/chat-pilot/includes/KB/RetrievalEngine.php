<?php
namespace ChatPilot\KB;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class RetrievalEngine
 * Keyword relevance ranker (RAG) matching user queries against enabled Knowledge Base documents.
 */
class RetrievalEngine {

	/**
	 * List of standard English stop words to exclude from keyword extraction.
	 *
	 * @var array
	 */
	private $stop_words = array(
		'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'arent', 'as', 'at', 
		'ask', 'asks', 'answer', 'answers', 'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by', 
		'can', 'cant', 'cannot', 'could', 'couldnt', 'did', 'didnt', 'do', 'does', 'doesnt', 'doing', 'dont', 'down', 'during', 
		'each', 'few', 'for', 'from', 'further', 'get', 'gets', 'give', 'gives', 'go', 'goes', 'had', 'hadnt', 'has', 'hasnt', 'have', 'havent', 
		'having', 'he', 'hed', 'hell', 'hes', 'her', 'here', 'heres', 'hers', 'herself', 'him', 'himself', 'his', 'how', 'hows', 'hi', 'hello', 'hey',
		'i', 'id', 'ill', 'im', 'ive', 'if', 'in', 'into', 'is', 'isnt', 'it', 'its', 'itself', 'lets', 'like', 'likes', 
		'make', 'makes', 'me', 'more', 'most', 'mustnt', 'my', 'myself', 'need', 'needs', 'no', 'nor', 'not', 'of', 'off', 'on', 'once', 'only', 'or', 
		'other', 'ought', 'our', 'ours', 'ourselves', 'out', 'over', 'own', 'please', 'question', 'questions',
		'same', 'shant', 'she', 'shed', 'shell', 'shes', 'should', 'shouldnt', 'show', 'shows', 'so', 'some', 'such', 'take', 'takes', 'tell', 'tells', 'than', 'that', 'thats', 
		'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there', 'theres', 'these', 'they', 'theyd', 'theyll', 'theyre', 
		'theyve', 'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up', 'use', 'uses', 'very', 'was', 'wasnt', 'we', 'wed', 
		'well', 'were', 'weve', 'werent', 'what', 'whats', 'when', 'whens', 'where', 'wheres', 'which', 'while', 'who', 
		'whos', 'whom', 'why', 'whys', 'with', 'wont', 'would', 'wouldnt', 'you', 'youd', 'youll', 'youre', 'youve', 'your', 
		'yours', 'yourself', 'yourselves'
	);

	/**
	 * Tokenizes query, filters stop words, searches documents, and ranks matches.
	 * Adaptive retrieval routing based on query intent categories: overview, company, locations, contact, specific.
	 *
	 * @param string $query            Visitor input prompt.
	 * @param int    $max_results      Max documents to retrieve.
	 * @param bool   $bypass_threshold If true, returns documents below the confidence threshold.
	 * @return array List of ranked document matches containing relevance scores.
	 */
	/**
	 * Tokenizes query, filters stop words, searches documents across ALL enabled sources,
	 * applies threshold, groups overview intents for diversity, and sorts by priority weights.
	 *
	 * @param string $query            Visitor input prompt.
	 * @param int    $max_results      Max documents to retrieve.
	 * @param bool   $bypass_threshold If true, returns documents below the confidence threshold.
	 * @return array List of ranked document matches containing relevance scores.
	 */
	public function search( $query, $max_results = 3, $bypass_threshold = false ) {
		global $wpdb;
		$docs_table    = $wpdb->prefix . 'chat_pilot_kb_documents';
		$sources_table = $wpdb->prefix . 'chat_pilot_kb_sources';

		// 1. Extract keywords with stop-word fallback guard
		$tokens = $this->extract_keywords( $query );
		if ( empty( $tokens ) ) {
			return array();
		}

		// Detect intent and perform Query Expansion for broad questions
		$intent = $this->detect_intent( $query );
		if ( 'overview' === $intent ) {
			$expansion = array( 'service', 'services', 'provide', 'provides', 'offer', 'offers', 'help', 'helps', 'program', 'programs', 'training' );
			foreach ( $expansion as $exp_token ) {
				if ( ! in_array( $exp_token, $tokens, true ) ) {
					$tokens[] = $exp_token;
				}
			}
		} elseif ( 'company' === $intent ) {
			$expansion = array( 'about', 'company', 'business', 'who', 'story', 'history' );
			foreach ( $expansion as $exp_token ) {
				if ( ! in_array( $exp_token, $tokens, true ) ) {
					$tokens[] = $exp_token;
				}
			}
		} elseif ( 'contact' === $intent ) {
			$expansion = array( 'contact', 'touch', 'reach', 'phone', 'email', 'call', 'number', 'inquiry', 'message' );
			foreach ( $expansion as $exp_token ) {
				if ( ! in_array( $exp_token, $tokens, true ) ) {
					$tokens[] = $exp_token;
				}
			}
		} elseif ( 'locations' === $intent ) {
			$expansion = array( 'location', 'locations', 'located', 'address', 'area', 'areas', 'city', 'cities', 'where', 'serve' );
			foreach ( $expansion as $exp_token ) {
				if ( ! in_array( $exp_token, $tokens, true ) ) {
					$tokens[] = $exp_token;
				}
			}
		}

		// 2. Search ALL enabled knowledge base documents matching any keyword (no category restrictions first)
		$clauses = array();
		$params  = array();
		foreach ( $tokens as $token ) {
			$clauses[] = 'd.content LIKE %s OR d.title LIKE %s';
			$like      = '%' . $wpdb->esc_like( $token ) . '%';
			$params[]  = $like;
			$params[]  = $like;
		}

		$where_clause = implode( ' OR ', $clauses );
		$sql = "SELECT d.*, s.name as source_name, s.type as source_type 
		        FROM {$docs_table} d 
		        LEFT JOIN {$sources_table} s ON d.source_id = s.id 
		        WHERE d.status = 'enabled' AND ({$where_clause})";

		$results = $wpdb->get_results( $wpdb->prepare( $sql, $params ), ARRAY_A );

		if ( empty( $results ) ) {
			return array();
		}

		// 3. Precompute IDF values and calculate similarity scores
		$idf = $this->precompute_idf( $tokens, $docs_table );

		$scored_docs = array();
		foreach ( $results as $doc ) {
			$score = $this->calculate_score( $doc, $tokens, $idf, $query );
			if ( $score > 0 ) {
				$doc['relevance_score'] = $score;
				$scored_docs[] = $doc;
			}
		}

		if ( empty( $scored_docs ) ) {
			return array();
		}

		// 4. Enforce confidence retrieval threshold (default 3.0)
		$plugin    = \ChatPilot\Core\Plugin::instance();
		$threshold = floatval( $plugin->settings->get( 'knowledge_base.retrieval_threshold', 3.0 ) );

		if ( ! $bypass_threshold ) {
			$filtered_docs = array();
			foreach ( $scored_docs as $doc ) {
				if ( $doc['relevance_score'] >= $threshold ) {
					$filtered_docs[] = $doc;
				}
			}
			$scored_docs = $filtered_docs;
		}

		if ( empty( $scored_docs ) ) {
			return array();
		}

		// 5. Detect query intent
		$intent = $this->detect_intent( $query );

		// 6. Apply context diversity grouping for overview requests (deduplicate website pages by URL)
		if ( 'overview' === $intent ) {
			$grouped_website_docs = array();
			$other_docs = array();

			foreach ( $scored_docs as $doc ) {
				if ( 'website' === $doc['source_type'] ) {
					$url = $doc['source_url'];
					if ( ! isset( $grouped_website_docs[ $url ] ) ) {
						$grouped_website_docs[ $url ] = array();
					}
					$grouped_website_docs[ $url ][] = $doc;
				} else {
					$other_docs[] = $doc;
				}
			}

			// Extract only the best-scoring segment for each unique website URL
			$diverse_website_docs = array();
			foreach ( $grouped_website_docs as $url => $docs_list ) {
				usort( $docs_list, function( $a, $b ) {
					return $b['relevance_score'] <=> $a['relevance_score'];
				} );
				$diverse_website_docs[] = $docs_list[0];
			}

			// Reassemble diversity coverage pool
			$scored_docs = array_merge( $other_docs, $diverse_website_docs );
			
			// Increase max results budget for overview to capture broad context
			$max_results = max( 8, $max_results );
		}

		// 7. Sort by Source Type Priority first (FAQ > Manual > File > Website), and secondarily by relevance score
		$type_priority = array(
			'faq'     => 4,
			'manual'  => 3,
			'file'    => 2,
			'website' => 1,
		);

		usort( $scored_docs, function( $a, $b ) use ( $type_priority ) {
			// If score difference is significant (greater than 1.5 points), sort strictly by score
			if ( abs( $a['relevance_score'] - $b['relevance_score'] ) > 1.5 ) {
				return $b['relevance_score'] <=> $a['relevance_score'];
			}

			// Otherwise, if they are close, sort by source type priority first
			$p_a = isset( $type_priority[ $a['source_type'] ] ) ? $type_priority[ $a['source_type'] ] : 0;
			$p_b = isset( $type_priority[ $b['source_type'] ] ) ? $type_priority[ $b['source_type'] ] : 0;

			if ( $p_a !== $p_b ) {
				return $p_b <=> $p_a;
			}

			// If priorities are equal, sort by exact score descending
			return $b['relevance_score'] <=> $a['relevance_score'];
		} );

		return array_slice( $scored_docs, 0, $max_results );
	}

	/**
	 * Searches and builds formatted context content block for AI generation.
	 *
	 * @param string $query     Visitor input prompt.
	 * @param int    $word_limit Max word budget for context string.
	 * @return string Formatted context ready for injection.
	 */
	public function retrieve_context( $query, $word_limit = 1000 ) {
		$documents = $this->search( $query, 5 );
		if ( empty( $documents ) ) {
			return '';
		}

		$context_parts = array();
		$current_words = 0;

		foreach ( $documents as $doc ) {
			$text = sprintf(
				"Source: [%s] (%s)\nTitle: %s\nContent:\n%s",
				$doc['source_name'],
				$doc['source_url'],
				$doc['title'],
				$doc['content']
			);

			$words = preg_split( '/\s+/', trim( $text ) );
			$word_count = is_array( $words ) ? count( $words ) : 0;

			if ( $current_words + $word_count > $word_limit ) {
				// Slice text block if budget allows.
				if ( $current_words < $word_limit ) {
					$slice_words = array_slice( $words, 0, $word_limit - $current_words );
					$context_parts[] = implode( ' ', $slice_words ) . "\n[Truncated...]";
				}
				break;
			}

			$context_parts[] = $text;
			$current_words  += $word_count;
		}

		return implode( "\n\n---\n\n", $context_parts );
	}

	/**
	 * Extracts lowercase alphanumeric keyword tokens while removing stop words.
	 * Includes suffix-stemming and sub-tokenization for dashed keywords.
	 *
	 * @param string $query Visitor prompt.
	 * @return array Tokens list.
	 */
	private function extract_keywords( $query ) {
		$query = strtolower( $query );
		// Strip punctuation.
		$query = preg_replace( '/[^\w\s-]/', '', $query );
		$words = preg_split( '/\s+/', $query );
		
		if ( ! is_array( $words ) ) {
			return array();
		}

		$keywords = array();
		foreach ( $words as $word ) {
			$word = trim( $word );
			if ( strlen( $word ) > 1 && ! in_array( $word, $this->stop_words, true ) ) {
				$keywords[] = $word;
				
				// Handle dashed words (e.g. roll-off -> roll, off)
				if ( strpos( $word, '-' ) !== false ) {
					$parts = explode( '-', $word );
					foreach ( $parts as $p ) {
						$p = trim( $p );
						if ( strlen( $p ) > 1 && ! in_array( $p, $this->stop_words, true ) ) {
							$keywords[] = $p;
						}
					}
				}
			}
		}

		// Stemming heuristic: if token ends in 's', add the singular form as well to handle plurals
		$stemmed = array();
		foreach ( $keywords as $tok ) {
			$stemmed[] = $tok;
			if ( strlen( $tok ) > 3 && substr( $tok, -1 ) === 's' ) {
				$stemmed[] = substr( $tok, 0, -1 );
			}
		}

		// Fallback: If ALL query words are stop words, extract all words with length > 2 as search keywords
		if ( empty( $stemmed ) ) {
			foreach ( $words as $word ) {
				$word = trim( $word );
				if ( strlen( $word ) > 2 ) {
					$stemmed[] = $word;
					if ( strlen( $word ) > 3 && substr( $word, -1 ) === 's' ) {
						$stemmed[] = substr( $word, 0, -1 );
					}
				}
			}
		}

		return array_values( array_unique( $stemmed ) );
	}

	/**
	 * Detects query intent from user text.
	 *
	 * @param string $query User query prompt.
	 * @return string Intent category ('overview', 'company', 'contact', 'locations', 'specific')
	 */
	public function detect_intent( $query ) {
		$q = strtolower( trim( $query ) );

		// 1. Contact Intent
		if ( preg_match( '/\b(contact|phone|telephone|cell|call|email|reach|touch|address|number|inquiry|write to)\b/', $q ) ) {
			return 'contact';
		}

		// 2. Locations Intent
		if ( preg_match( '/\b(area|areas|serve|location|locations|located|cities|city|zip|zips|where|address|place|county|coverage|state)\b/', $q ) ) {
			return 'locations';
		}

		// 3. Company Info Intent
		if ( preg_match( '/\b(about|who are|overview|history|company|firm|business|team|owner|origin|story|what is|who is)\b/', $q ) ) {
			return 'company';
		}

		// 4. Overview Request (Broad summary questions on services/features)
		if ( preg_match( '/\b(services|service|all services|what do you do|what do you provide|what do you offer|what does dumpking do|what does dumpking provide|help me with|help with|what do you have|what kind of|can you tell me about|what all|what is included)\b/', $q ) ) {
			// If it mentions a specific service, fall back to specific Fact
			if ( ! preg_match( '/\b(trailer|demolition|junk|hauling|cleanup|construction|plumbing|pizza|beach|color)\b/', $q ) ) {
				return 'overview';
			}
		}

		// 5. Default Specific fact query
		return 'specific';
	}

	/**
	 * Precomputes IDF weights for tokens list.
	 */
	private function precompute_idf( array $tokens, $docs_table ) {
		global $wpdb;
		$total_docs = $wpdb->get_var( "SELECT COUNT(*) FROM {$docs_table} WHERE status = 'enabled'" );
		$total_docs = max( 1, intval( $total_docs ) );
		$idf = array();

		foreach ( $tokens as $token ) {
			$doc_count = $wpdb->get_var( $wpdb->prepare(
				"SELECT COUNT(*) FROM {$docs_table} WHERE status = 'enabled' AND (content LIKE %s OR title LIKE %s)",
				'%' . $wpdb->esc_like( $token ) . '%',
				'%' . $wpdb->esc_like( $token ) . '%'
			) );
			$doc_count = max( 1, intval( $doc_count ) );
			$idf[ $token ] = log( $total_docs / $doc_count ) + 1.0;
		}
		return $idf;
	}

	/**
	 * Calculates relevance score for a document.
	 */
	private function calculate_score( array $doc, array $tokens, array $idf, $query ) {
		$score   = 0;
		$content = strtolower( $doc['content'] );
		$title   = strtolower( $doc['title'] );
		$query_lower = strtolower( trim( $query ) );

		// 1. Keyword level matching using TF-IDF weights with word boundaries
		foreach ( $tokens as $token ) {
			$content_matches = 0;
			if ( preg_match_all( '/\b' . preg_quote( $token, '/' ) . '\b/i', $content, $matches ) ) {
				$content_matches = count( $matches[0] );
			}

			$token_weight = isset( $idf[ $token ] ) ? $idf[ $token ] : 1.0;
			$score += ( $content_matches * $token_weight );

			if ( preg_match( '/\b' . preg_quote( $token, '/' ) . '\b/i', $title ) ) {
				$score += ( 25.0 * $token_weight );
			}
		}

		// 2. Phrase matching boost
		if ( count( $tokens ) > 1 ) {
			if ( strpos( $content, $query_lower ) !== false ) {
				$score += 12.0;
			}
			if ( strpos( $title, $query_lower ) !== false ) {
				$score += 25.0;
			}
		}

		if ( $score > 0 ) {
			$word_count = max( 1, intval( $doc['word_count'] ) );
			return round( $score / log( $word_count + 1.5 ), 4 );
		}

		return 0.0;
	}
}
