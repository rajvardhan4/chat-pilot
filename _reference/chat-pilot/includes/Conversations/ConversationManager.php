<?php
namespace ChatPilot\Conversations;

// Prevent direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class ConversationManager
 * Manages database CRUD, querying, status updates, message appends, and metadata tracking for Conversations.
 */
class ConversationManager {

	/**
	 * Table name without prefix.
	 *
	 * @var string
	 */
	private $table_base = 'chat_pilot_conversations';

	/**
	 * Constructor. Ensures missing columns exist for backwards compatibility.
	 */
	public function __construct() {
		$this->ensure_columns_exist();
	}

	/**
	 * Returns full table name with prefix.
	 *
	 * @return string
	 */
	private function get_table_name() {
		global $wpdb;
		return $wpdb->prefix . $this->table_base;
	}

	private static $columns_checked = false;

	/**
	 * Ensures columns exist in existing database table.
	 */
	private function ensure_columns_exist() {
		global $wpdb;
		if ( self::$columns_checked ) {
			return;
		}
		self::$columns_checked = true;

		$table = $this->get_table_name();

		// Check if table exists
		if ( $wpdb->get_var( $wpdb->prepare( "SHOW TABLES LIKE %s", $table ) ) !== $table ) {
			return;
		}

		$columns = $wpdb->get_col( "DESCRIBE {$table}", 0 );
		if ( empty( $columns ) ) {
			return;
		}

		if ( ! in_array( 'form_id', $columns, true ) ) {
			$wpdb->query( "ALTER TABLE {$table} ADD COLUMN form_id bigint(20) unsigned DEFAULT 0 NOT NULL AFTER session_id" );
		}
		if ( ! in_array( 'source', $columns, true ) ) {
			$wpdb->query( "ALTER TABLE {$table} ADD COLUMN source varchar(50) DEFAULT 'widget' NOT NULL AFTER visitor_phone" );
		}
		if ( ! in_array( 'status', $columns, true ) ) {
			$wpdb->query( "ALTER TABLE {$table} ADD COLUMN status varchar(20) DEFAULT 'active' NOT NULL AFTER source" );
		}
		if ( ! in_array( 'is_read', $columns, true ) ) {
			$wpdb->query( "ALTER TABLE {$table} ADD COLUMN is_read tinyint(1) DEFAULT 0 NOT NULL AFTER status" );
		}
		if ( ! in_array( 'metadata', $columns, true ) ) {
			$wpdb->query( "ALTER TABLE {$table} ADD COLUMN metadata longtext NOT NULL AFTER messages" );
		}
		if ( ! in_array( 'summary', $columns, true ) ) {
			$wpdb->query( "ALTER TABLE {$table} ADD COLUMN summary text DEFAULT NULL AFTER metadata" );
		}
	}

	/**
	 * Generates a concise, accurate summary from conversation messages.
	 *
	 * @param array $messages Array of message items.
	 * @return string Summary sentence.
	 */
	public function generate_summary( $messages ) {
		if ( empty( $messages ) || ! is_array( $messages ) ) {
			return 'Conversation initiated.';
		}

		$user_queries = array();
		foreach ( $messages as $m ) {
			if ( isset( $m['role'] ) && 'user' === strtolower( $m['role'] ) && ! empty( $m['content'] ) ) {
				$txt = trim( $m['content'] );
				if ( preg_match( '/^(hi|hello|hey|greetings|hola|good morning|good afternoon)\b/i', $txt ) && strlen( $txt ) < 15 ) {
					continue;
				}
				$user_queries[] = $txt;
			}
		}

		if ( empty( $user_queries ) ) {
			return 'Visitor initiated conversation with a greeting.';
		}

		$topics = array();
		$combined_text = strtolower( implode( ' ', $user_queries ) );

		if ( preg_match( '/(dumpster|rental|container|roll-off|waste|trash|junk)/i', $combined_text ) ) {
			$topics[] = 'residential dumpster rentals';
		}
		if ( preg_match( '/(price|pricing|cost|quote|rate|fee|discount|military|deal|sale)/i', $combined_text ) ) {
			$topics[] = 'military discounts & pricing';
		}
		if ( preg_match( '/(area|location|city|zip|address|deliver|serve|coverage)/i', $combined_text ) ) {
			$topics[] = 'service areas';
		}
		if ( preg_match( '/(service|feature|product|offer|type|option)/i', $combined_text ) && ! in_array( 'residential dumpster rentals', $topics, true ) ) {
			$topics[] = 'services offered';
		}
		if ( preg_match( '/(hour|time|open|schedule|appointment|contact|support|phone|email)/i', $combined_text ) ) {
			$topics[] = 'business hours & contact details';
		}

		if ( ! empty( $topics ) ) {
			if ( count( $topics ) === 1 ) {
				return 'Visitor asked about ' . $topics[0] . '.';
			} elseif ( count( $topics ) === 2 ) {
				return 'Visitor asked about ' . $topics[0] . ' and ' . $topics[1] . '.';
			} else {
				$last_topic = array_pop( $topics );
				return 'Visitor asked about ' . implode( ', ', $topics ) . ', and ' . $last_topic . '.';
			}
		}

		$clean_phrases = array();
		foreach ( $user_queries as $q ) {
			$q_clean = trim( rtrim( $q, '?!.' ) );
			if ( strlen( $q_clean ) > 60 ) {
				$q_clean = substr( $q_clean, 0, 57 ) . '...';
			}
			$clean_phrases[] = $q_clean;
		}

		$summary = 'Visitor asked about ' . implode( ', ', array_slice( $clean_phrases, 0, 3 ) ) . '.';
		if ( strlen( $summary ) > 160 ) {
			$summary = substr( $summary, 0, 157 ) . '...';
		}

		return ucfirst( $summary );
	}

	/**
	 * Automatically completes inactive conversations (no activity for > 30 minutes).
	 *
	 * @param int $timeout_seconds Inactivity threshold (default 1800s / 30 mins).
	 * @return int Number of rows completed.
	 */
	public function auto_complete_inactive_conversations( $timeout_seconds = 1800 ) {
		global $wpdb;
		$table = $this->get_table_name();
		$cutoff = date( 'Y-m-d H:i:s', current_time( 'timestamp' ) - intval( $timeout_seconds ) );

		$updated = $wpdb->query( $wpdb->prepare(
			"UPDATE {$table} SET status = 'completed' WHERE status = 'active' AND updated_at < %s",
			$cutoff
		) );

		return ( $updated !== false ) ? intval( $updated ) : 0;
	}

	/**
	 * Fetches conversations list with filtering and search capabilities.
	 *
	 * @param array $args Filter arguments.
	 * @return array
	 */
	public function get_conversations( $args = array() ) {
		global $wpdb;
		$table = $this->get_table_name();

		// Run automatic 30-minute inactivity timeout completion
		$this->auto_complete_inactive_conversations( 1800 );

		$where  = array('1=1');
		$params = array();

		// Status filter (active, completed, archived)
		if ( ! empty( $args['status'] ) && 'all' !== $args['status'] ) {
			$where[]  = 'status = %s';
			$params[] = sanitize_key( $args['status'] );
		}

		// Source filter (widget, playground)
		if ( ! empty( $args['source'] ) && 'all' !== $args['source'] ) {
			$where[]  = 'source = %s';
			$params[] = sanitize_key( $args['source'] );
		}

		// Form ID filter
		if ( ! empty( $args['form_id'] ) ) {
			$where[]  = 'form_id = %d';
			$params[] = intval( $args['form_id'] );
		}

		// Inverted Date Range handling
		if ( ! empty( $args['date_from'] ) && ! empty( $args['date_to'] ) ) {
			$from_ts = strtotime( $args['date_from'] );
			$to_ts   = strtotime( $args['date_to'] );
			if ( $from_ts && $to_ts && $from_ts > $to_ts ) {
				$temp = $args['date_from'];
				$args['date_from'] = $args['date_to'];
				$args['date_to']   = $temp;
			}
		}

		// Date From filter
		if ( ! empty( $args['date_from'] ) ) {
			$where[]  = 'created_at >= %s';
			$params[] = sanitize_text_field( $args['date_from'] ) . ' 00:00:00';
		}

		// Date To filter
		if ( ! empty( $args['date_to'] ) ) {
			$where[]  = 'created_at <= %s';
			$params[] = sanitize_text_field( $args['date_to'] ) . ' 23:59:59';
		}

		// Search query (Name, Email, Phone, Conversation ID, Message text, Summary)
		if ( ! empty( $args['search'] ) ) {
			$search = sanitize_text_field( wp_unslash( $args['search'] ) );
			if ( is_numeric( $search ) ) {
				$where[]  = '(id = %d OR session_id LIKE %s OR visitor_name LIKE %s OR visitor_email LIKE %s OR visitor_phone LIKE %s OR messages LIKE %s OR summary LIKE %s)';
				$like     = '%' . $wpdb->esc_like( $search ) . '%';
				$params[] = intval( $search );
				$params[] = $like;
				$params[] = $like;
				$params[] = $like;
				$params[] = $like;
				$params[] = $like;
				$params[] = $like;
			} else {
				$where[]  = '(session_id LIKE %s OR visitor_name LIKE %s OR visitor_email LIKE %s OR visitor_phone LIKE %s OR messages LIKE %s OR summary LIKE %s)';
				$like     = '%' . $wpdb->esc_like( $search ) . '%';
				$params[] = $like;
				$params[] = $like;
				$params[] = $like;
				$params[] = $like;
				$params[] = $like;
				$params[] = $like;
			}
		}

		$where_clause = implode( ' AND ', $where );
		$sql          = "SELECT * FROM {$table} WHERE {$where_clause} ORDER BY updated_at DESC";

		if ( ! empty( $params ) ) {
			$rows = $wpdb->get_results( $wpdb->prepare( $sql, $params ), ARRAY_A );
		} else {
			$rows = $wpdb->get_results( $sql, ARRAY_A );
		}

		if ( empty( $rows ) ) {
			return array();
		}

		// Parse JSON fields and resolve summary
		foreach ( $rows as &$row ) {
			$row['messages'] = ! empty( $row['messages'] ) ? json_decode( $row['messages'], true ) : array();
			$row['metadata'] = ! empty( $row['metadata'] ) ? json_decode( $row['metadata'], true ) : array();
			if ( empty( $row['summary'] ) ) {
				$row['summary'] = $this->generate_summary( $row['messages'] );
			}
		}

		return $rows;
	}

	/**
	 * Retrieves a single conversation by ID or session ID.
	 *
	 * @param int|string $identifier ID or session_id.
	 * @return array|null
	 */
	public function get_conversation( $identifier ) {
		global $wpdb;
		$table = $this->get_table_name();

		if ( is_numeric( $identifier ) ) {
			$row = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$table} WHERE id = %d", intval( $identifier ) ), ARRAY_A );
		} else {
			$row = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$table} WHERE session_id = %s", sanitize_text_field( $identifier ) ), ARRAY_A );
		}

		if ( ! $row ) {
			return null;
		}

		$row['messages'] = ! empty( $row['messages'] ) ? json_decode( $row['messages'], true ) : array();
		$row['metadata'] = ! empty( $row['metadata'] ) ? json_decode( $row['metadata'], true ) : array();

		return $row;
	}

	/**
	 * Saves or appends a message to a conversation.
	 *
	 * @param string $session_id Session token.
	 * @param array  $message_data Array with role ('user'|'bot'|'assistant'), content, time.
	 * @param array  $visitor_data Array with name, email, phone, form_id.
	 * @param string $source 'widget' or 'playground'.
	 * @param array  $metadata Provider/model/latency/tokens execution metadata.
	 * @return int Conversation ID.
	 */
	public function save_message( $session_id, $message_data, $visitor_data = array(), $source = 'widget', $metadata = array() ) {
		global $wpdb;
		$table = $this->get_table_name();

		$existing = $this->get_conversation( $session_id );
		$now      = current_time( 'mysql' );

		if ( $existing ) {
			$conv_id  = $existing['id'];
			$messages = $existing['messages'];
			$messages[] = $message_data;

			$merged_metadata = is_array( $existing['metadata'] ) ? $existing['metadata'] : array();
			if ( ! empty( $metadata ) ) {
				$requests = ( isset( $merged_metadata['ai_requests'] ) && is_array( $merged_metadata['ai_requests'] ) )
					? $merged_metadata['ai_requests']
					: array();
				if ( isset( $metadata['provider'] ) ) {
					$req_entry              = $metadata;
					$req_entry['timestamp'] = ! empty( $req_entry['timestamp'] ) ? $req_entry['timestamp'] : current_time( 'mysql' );
					$req_entry['source']    = $source;
					$requests[]             = $req_entry;
				}
				$merged_metadata                = array_merge( $merged_metadata, $metadata );
				$merged_metadata['ai_requests'] = $requests;
			}

			$update_data = array(
				'messages'   => wp_json_encode( $messages ),
				'metadata'   => wp_json_encode( $merged_metadata ),
				'updated_at' => $now,
			);

			// Update visitor credentials if provided and non-empty
			if ( ! empty( $visitor_data['name'] ) ) {
				$update_data['visitor_name'] = sanitize_text_field( $visitor_data['name'] );
			}
			if ( ! empty( $visitor_data['email'] ) ) {
				$update_data['visitor_email'] = sanitize_email( $visitor_data['email'] );
			}
			if ( ! empty( $visitor_data['phone'] ) ) {
				$update_data['visitor_phone'] = sanitize_text_field( $visitor_data['phone'] );
			}
			if ( isset( $visitor_data['form_id'] ) && intval( $visitor_data['form_id'] ) > 0 ) {
				$update_data['form_id'] = intval( $visitor_data['form_id'] );
			}

			// If new user message arrived, mark as unread for admin and reactivate if completed
			if ( isset( $message_data['role'] ) && 'user' === strtolower( $message_data['role'] ) ) {
				$update_data['is_read'] = 0;
				$update_data['status']  = 'active';
			}

			// Generate dynamic summary
			$update_data['summary'] = $this->generate_summary( $messages );

			$wpdb->update( $table, $update_data, array( 'id' => $conv_id ) );

			// Link submission to this conversation
			$form_mgr = new \ChatPilot\Forms\FormManager();
			$form_mgr->associate_submission_with_conversation( $session_id, $conv_id, ! empty( $visitor_data['email'] ) ? $visitor_data['email'] : '' );

			return $conv_id;
		} else {
			$messages = array( $message_data );

			$name    = ! empty( $visitor_data['name'] ) ? sanitize_text_field( $visitor_data['name'] ) : '';
			$email   = ! empty( $visitor_data['email'] ) ? sanitize_email( $visitor_data['email'] ) : '';
			$phone   = ! empty( $visitor_data['phone'] ) ? sanitize_text_field( $visitor_data['phone'] ) : '';
			$form_id = isset( $visitor_data['form_id'] ) ? intval( $visitor_data['form_id'] ) : 0;
			$summary = $this->generate_summary( $messages );

			$initial_metadata = is_array( $metadata ) ? $metadata : array();
			if ( ! empty( $initial_metadata ) && isset( $initial_metadata['provider'] ) ) {
				$req_entry                      = $initial_metadata;
				$req_entry['timestamp']         = ! empty( $req_entry['timestamp'] ) ? $req_entry['timestamp'] : current_time( 'mysql' );
				$req_entry['source']            = $source;
				$initial_metadata['ai_requests'] = array( $req_entry );
			}

			$wpdb->insert(
				$table,
				array(
					'session_id'    => sanitize_text_field( $session_id ),
					'form_id'       => $form_id,
					'visitor_name'  => $name,
					'visitor_email' => $email,
					'visitor_phone' => $phone,
					'source'        => sanitize_key( $source ),
					'status'        => 'active',
					'is_read'       => ( isset( $message_data['role'] ) && 'user' === strtolower( $message_data['role'] ) ) ? 0 : 1,
					'messages'      => wp_json_encode( $messages ),
					'metadata'      => wp_json_encode( $initial_metadata ),
					'summary'       => $summary,
					'created_at'    => $now,
					'updated_at'    => $now,
				)
			);

			$new_conv_id = $wpdb->insert_id;

			// Link submission to this conversation
			$form_mgr = new \ChatPilot\Forms\FormManager();
			$form_mgr->associate_submission_with_conversation( $session_id, $new_conv_id, $email );

			// Trigger New Conversation Email Notification gracefully
			if ( $new_conv_id ) {
				$notifier = new \ChatPilot\Notifications\NotificationManager();
				$notifier->trigger_conversation_notification( $new_conv_id, array(
					'session_id'    => $session_id,
					'visitor_name'  => $name,
					'visitor_email' => $email,
					'visitor_phone' => $phone,
					'first_message' => isset( $message_data['content'] ) ? $message_data['content'] : '',
				) );
			}

			return $new_conv_id;
		}
	}

	/**
	 * Updates status of a conversation.
	 *
	 * @param int    $id Conversation ID.
	 * @param string $status 'active', 'completed', 'archived'.
	 * @return bool
	 */
	public function update_status( $id, $status ) {
		global $wpdb;
		$table  = $this->get_table_name();
		$status = sanitize_key( $status );

		if ( ! in_array( $status, array( 'active', 'completed', 'archived' ), true ) ) {
			return false;
		}

		$updated = $wpdb->update(
			$table,
			array(
				'status'     => $status,
				'updated_at' => current_time( 'mysql' ),
			),
			array( 'id' => intval( $id ) )
		);

		return false !== $updated;
	}

	/**
	 * Toggles read / unread status.
	 *
	 * @param int $id Conversation ID.
	 * @param int $is_read 1 for read, 0 for unread.
	 * @return bool
	 */
	public function mark_read( $id, $is_read = 1 ) {
		global $wpdb;
		$table = $this->get_table_name();

		$updated = $wpdb->update(
			$table,
			array( 'is_read' => $is_read ? 1 : 0 ),
			array( 'id' => intval( $id ) )
		);

		return false !== $updated;
	}

	/**
	 * Deletes a conversation record.
	 *
	 * @param int $id Conversation ID.
	 * @return bool
	 */
	public function delete_conversation( $id ) {
		global $wpdb;
		$table   = $this->get_table_name();
		$deleted = $wpdb->delete( $table, array( 'id' => intval( $id ) ) );

		return false !== $deleted;
	}

	/**
	 * Streams CSV download of conversation logs.
	 *
	 * @param array $args Filter arguments.
	 */
	public function export_csv( $args = array() ) {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( 'Unauthorized user access.' );
		}

		$rows = $this->get_conversations( $args );

		ob_clean();
		header( 'Content-Type: text/csv; charset=utf-8' );
		header( 'Content-Disposition: attachment; filename=chat-pilot-conversations-' . date( 'Y-m-d' ) . '.csv' );

		$csv = fopen( 'php://output', 'w' );
		fputcsv( $csv, array( 'ID', 'Session ID', 'Status', 'Source', 'Visitor Name', 'Email', 'Phone', 'Messages Count', 'Started At', 'Last Activity' ) );

		foreach ( $rows as $r ) {
			fputcsv( $csv, array(
				$r['id'],
				$r['session_id'],
				strtoupper( $r['status'] ),
				strtoupper( $r['source'] ),
				$r['visitor_name'],
				$r['visitor_email'],
				$r['visitor_phone'],
				count( $r['messages'] ),
				$r['created_at'],
				$r['updated_at'],
			) );
		}

		fclose( $csv );
		exit;
	}
}
