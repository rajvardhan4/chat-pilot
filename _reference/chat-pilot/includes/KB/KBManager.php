<?php
namespace ChatPilot\KB;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class KBManager
 * Coordinator for Knowledge Base sources, ingestion pipelines, and document persistence.
 */
class KBManager {

	/**
	 * Registers a new knowledge source in the database options/tables.
	 *
	 * @param string $type   Source type identifier ('website', 'file', 'manual', 'faq').
	 * @param string $name   Descriptive name.
	 * @param array  $config Configuration settings map.
	 * @return int|bool Created source ID or false.
	 */
	public function add_source( $type, $name, array $config ) {
		global $wpdb;
		$sources_table = $wpdb->prefix . 'chat_pilot_kb_sources';

		$timestamp = current_time( 'mysql' );
		$inserted  = $wpdb->insert(
			$sources_table,
			array(
				'type'          => sanitize_key( $type ),
				'name'          => sanitize_text_field( $name ),
				'config'        => wp_json_encode( $config ),
				'status'        => 'pending',
				'last_sync'     => null,
				'error_message' => null,
				'created_at'    => $timestamp,
				'updated_at'    => $timestamp,
			)
		);

		if ( ! $inserted ) {
			return false;
		}

		return $wpdb->insert_id;
	}

	/**
	 * Deletes a source and executes cascading deletes on all linked documents.
	 *
	 * @param int $source_id KB Source identifier.
	 * @return bool True on success.
	 */
	public function delete_source( $source_id ) {
		global $wpdb;
		$sources_table = $wpdb->prefix . 'chat_pilot_kb_sources';
		$docs_table    = $wpdb->prefix . 'chat_pilot_kb_documents';

		// Get source config to delete files if necessary.
		$source = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$sources_table} WHERE id = %d", $source_id ), ARRAY_A );
		if ( $source ) {
			$config = json_decode( $source['config'], true );
			if ( 'file' === $source['type'] && ! empty( $config['file_path'] ) && file_exists( $config['file_path'] ) ) {
				@unlink( $config['file_path'] );
			}
		}

		// Delete docs and source records.
		$wpdb->delete( $docs_table, array( 'source_id' => $source_id ) );
		$deleted = $wpdb->delete( $sources_table, array( 'id' => $source_id ) );

		return (false !== $deleted);
	}

	/**
	 * Toggles status ('enabled', 'disabled') of a specific document.
	 *
	 * @param int  $doc_id  Document ID.
	 * @param bool $enable  True to enable, false to disable.
	 * @return bool True on success.
	 */
	public function toggle_document_status( $doc_id, $enable ) {
		global $wpdb;
		$docs_table = $wpdb->prefix . 'chat_pilot_kb_documents';

		$status  = $enable ? 'enabled' : 'disabled';
		$updated = $wpdb->update(
			$docs_table,
			array( 'status' => $status ),
			array( 'id' => intval( $doc_id ) )
		);

		return (false !== $updated);
	}

	/**
	 * Triggers the parsing drivers to process and ingest contents.
	 *
	 * @param int $source_id KB Source identifier.
	 * @return bool True on success.
	 */
	public function sync_source( $source_id ) {
		global $wpdb;
		$sources_table = $wpdb->prefix . 'chat_pilot_kb_sources';
		$docs_table    = $wpdb->prefix . 'chat_pilot_kb_documents';

		$source = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$sources_table} WHERE id = %d", $source_id ), ARRAY_A );
		if ( ! $source ) {
			return false;
		}

		// Set status to processing.
		$wpdb->update( $sources_table, array( 'status' => 'processing', 'error_message' => null ), array( 'id' => $source_id ) );

		$config = json_decode( $source['config'], true );
		$type   = $source['type'];
		$parser = null;

		switch ( $type ) {
			case 'website':
				$parser = new WebCrawler();
				break;
			case 'file':
				$ext = strtolower( pathinfo( $config['file_path'], PATHINFO_EXTENSION ) );
				if ( 'pdf' === $ext ) {
					$parser = new PDFParser();
				} elseif ( 'docx' === $ext ) {
					$parser = new DocxParser();
				} else {
					$parser = new TxtParser();
				}
				break;
		}

		try {
			$documents = array();
			$timestamp = current_time( 'mysql' );

			if ( 'manual' === $type ) {
				$content       = isset( $config['content'] ) ? $config['content'] : '';
				$clean_content = $content;
				
				// Calculate word count.
				$words = preg_split( '/\s+/', trim( $clean_content ) );
				$word_count = is_array( $words ) ? count( $words ) : 0;

				$documents = array(
					array(
						'title'      => $source['name'],
						'content'    => $clean_content,
						'source_url' => 'manual://' . $source_id,
						'metadata'   => array(
							'category'   => isset( $config['category'] ) ? $config['category'] : '',
							'tags'       => isset( $config['tags'] ) ? $config['tags'] : '',
							'word_count' => $word_count,
						),
					),
				);
			} elseif ( 'faq' === $type ) {
				$question      = isset( $config['question'] ) ? $config['question'] : '';
				$answer        = isset( $config['answer'] ) ? $config['answer'] : '';
				$formatted_faq = sprintf( "Question: %s\nAnswer: %s", $question, $answer );
				
				$words = preg_split( '/\s+/', trim( $formatted_faq ) );
				$word_count = is_array( $words ) ? count( $words ) : 0;

				$documents = array(
					array(
						'title'      => $source['name'],
						'content'    => $formatted_faq,
						'source_url' => 'faq://' . $source_id,
						'metadata'   => array(
							'question'   => $question,
							'answer'     => $answer,
							'category'   => isset( $config['category'] ) ? $config['category'] : '',
							'word_count' => $word_count,
						),
					),
				);
			} elseif ( $parser ) {
				$documents = $parser->parse( $config );
			}

			// Clear old documents records.
			$wpdb->delete( $docs_table, array( 'source_id' => $source_id ) );

			if ( empty( $documents ) ) {
				throw new \Exception( esc_html__( 'No content could be extracted from this source.', 'chat-pilot' ) );
			}

			// Insert extracted documents.
			foreach ( $documents as $doc ) {
				$metadata = is_array( $doc['metadata'] ) ? $doc['metadata'] : array();
				
				// Automatically classify page if category metadata is blank
				if ( empty( $metadata['category'] ) ) {
					$metadata['category'] = self::classify_document( $doc['title'], $doc['content'], $doc['source_url'] );
				} else {
					// Normalize user manual inputs to intent mappings
					$typed = strtolower( trim( $metadata['category'] ) );
					if ( strpos( $typed, 'service' ) !== false || strpos( $typed, 'work' ) !== false ) {
						$metadata['category'] = 'Services';
					} elseif ( strpos( $typed, 'about' ) !== false || strpos( $typed, 'company' ) !== false || strpos( $typed, 'info' ) !== false ) {
						$metadata['category'] = 'Company';
					} elseif ( strpos( $typed, 'location' ) !== false || strpos( $typed, 'area' ) !== false || strpos( $typed, 'serve' ) !== false ) {
						$metadata['category'] = 'Locations';
					} elseif ( strpos( $typed, 'contact' ) !== false || strpos( $typed, 'touch' ) !== false ) {
						$metadata['category'] = 'Contact';
					}
				}

				$wpdb->insert(
					$docs_table,
					array(
						'source_id'  => $source_id,
						'title'      => sanitize_text_field( $doc['title'] ),
						'content'    => $doc['content'], // Store clean raw format text
						'source_url' => esc_url_raw( $doc['source_url'] ),
						'metadata'   => wp_json_encode( $metadata ),
						'status'     => 'enabled',
						'word_count' => intval( $metadata['word_count'] ?? 0 ),
						'created_at' => $timestamp,
						'updated_at' => $timestamp,
					)
				);
			}

			// Mark sync completed.
			$wpdb->update(
				$sources_table,
				array(
					'status'    => 'completed',
					'last_sync' => $timestamp,
				),
				array( 'id' => $source_id )
			);

			return true;

		} catch ( \Exception $e ) {
			// Mark sync failed.
			$wpdb->update(
				$sources_table,
				array(
					'status'        => 'failed',
					'error_message' => $e->getMessage(),
				),
				array( 'id' => $source_id )
			);
			return false;
		}
	}

	/**
	 * Retrieves registered KB sources.
	 *
	 * @param array $args Filter options array.
	 * @return array List of row records.
	 */
	public function get_sources( $args = array() ) {
		global $wpdb;
		$sources_table = $wpdb->prefix . 'chat_pilot_kb_sources';

		$where  = array( '1 = 1' );
		$params = array();

		if ( ! empty( $args['type'] ) ) {
			$where[]  = 'type = %s';
			$params[] = $args['type'];
		}
		if ( ! empty( $args['status'] ) ) {
			$where[]  = 'status = %s';
			$params[] = $args['status'];
		}

		$where_sql = implode( ' AND ', $where );
		
		$sql = "SELECT * FROM {$sources_table} WHERE {$where_sql} ORDER BY created_at DESC";
		if ( ! empty( $params ) ) {
			$sql = $wpdb->prepare( $sql, $params );
		}

		return $wpdb->get_results( $sql, ARRAY_A );
	}

	/**
	 * Retrieves individual documents entries.
	 *
	 * @param array $args Filter and pagination parameters.
	 * @return array List of document rows.
	 */
	public function get_documents( $args = array() ) {
		global $wpdb;
		$docs_table    = $wpdb->prefix . 'chat_pilot_kb_documents';
		$sources_table = $wpdb->prefix . 'chat_pilot_kb_sources';

		$where  = array( '1 = 1' );
		$params = array();

		if ( ! empty( $args['source_id'] ) ) {
			$where[]  = 'd.source_id = %d';
			$params[] = intval( $args['source_id'] );
		}
		if ( ! empty( $args['status'] ) ) {
			$where[]  = 'd.status = %s';
			$params[] = $args['status'];
		}
		if ( ! empty( $args['search'] ) ) {
			$where[]  = '(d.title LIKE %s OR d.content LIKE %s)';
			$like     = '%' . $wpdb->esc_like( $args['search'] ) . '%';
			$params[] = $like;
			$params[] = $like;
		}

		$where_sql = implode( ' AND ', $where );
		$sql       = "SELECT d.*, s.type as source_type, s.name as source_name 
		              FROM {$docs_table} d 
		              LEFT JOIN {$sources_table} s ON d.source_id = s.id 
		              WHERE {$where_sql} 
		              ORDER BY d.created_at DESC";

		if ( ! empty( $params ) ) {
			$sql = $wpdb->prepare( $sql, $params );
		}

		return $wpdb->get_results( $sql, ARRAY_A );
	}

	/**
	 * Classifies a document into Services, Company, Contact, or Locations based on title and content patterns.
	 *
	 * @param string $title   Document title.
	 * @param string $content Document content.
	 * @param string $url     Source URL (optional).
	 * @return string Categorized label.
	 */
	public static function classify_document( $title, $content, $url = '' ) {
		$title_lower   = strtolower( $title );
		$url_lower     = strtolower( $url );
		$content_lower = strtolower( substr( $content, 0, 500 ) );

		// 1. Check for Contact intent
		if ( strpos( $title_lower, 'contact' ) !== false || 
			 strpos( $url_lower, 'contact' ) !== false || 
			 strpos( $title_lower, 'get in touch' ) !== false || 
			 strpos( $title_lower, 'phone' ) !== false || 
			 strpos( $title_lower, 'email' ) !== false ||
			 strpos( $content_lower, 'contact us' ) !== false ) {
			return 'Contact';
		}

		// 2. Check for Locations intent
		if ( strpos( $title_lower, 'location' ) !== false || 
			 strpos( $url_lower, 'location' ) !== false || 
			 strpos( $title_lower, 'areas' ) !== false || 
			 strpos( $url_lower, 'areas' ) !== false || 
			 strpos( $title_lower, 'serve' ) !== false || 
			 strpos( $url_lower, 'serve' ) !== false || 
			 strpos( $title_lower, 'cities' ) !== false || 
			 strpos( $title_lower, 'coverage' ) !== false ||
			 strpos( $content_lower, 'service area' ) !== false ) {
			return 'Locations';
		}

		// 3. Check for Company / Info intent
		if ( strpos( $title_lower, 'about' ) !== false || 
			 strpos( $url_lower, 'about' ) !== false || 
			 strpos( $title_lower, 'who we are' ) !== false || 
			 strpos( $title_lower, 'overview' ) !== false || 
			 strpos( $title_lower, 'home' ) !== false || 
			 strpos( $title_lower, 'history' ) !== false || 
			 strpos( $title_lower, 'team' ) !== false || 
			 strpos( $title_lower, 'mission' ) !== false || 
			 strpos( $title_lower, 'values' ) !== false ) {
			return 'Company';
		}

		// 4. Default / Services intent
		return 'Services';
	}
}
