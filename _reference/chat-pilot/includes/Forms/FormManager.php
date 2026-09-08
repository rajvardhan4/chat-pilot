<?php
namespace ChatPilot\Forms;

// Prevent direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class FormManager
 * Handles database operations for lead forms and form submissions.
 */
class FormManager {

	/**
	 * Forms table name.
	 * @var string
	 */
	private $table_forms;

	/**
	 * Form submissions table name.
	 * @var string
	 */
	private $table_submissions;

	/**
	 * Constructor. Initializes table names.
	 */
	public function __construct() {
		global $wpdb;
		$this->table_forms       = $wpdb->prefix . 'chat_pilot_forms';
		$this->table_submissions = $wpdb->prefix . 'chat_pilot_form_submissions';
	}

	/**
	 * Retrieves all forms.
	 *
	 * @return array List of forms.
	 */
	public function get_forms() {
		global $wpdb;
		$results = $wpdb->get_results( "SELECT * FROM {$this->table_forms} ORDER BY id DESC", ARRAY_A );
		if ( empty( $results ) ) {
			// Seed default form and retrieve again.
			$this->get_default_form();
			$results = $wpdb->get_results( "SELECT * FROM {$this->table_forms} ORDER BY id DESC", ARRAY_A );
		}
		
		foreach ( $results as &$row ) {
			$row['fields'] = json_decode( $row['fields'], true );
		}
		return $results;
	}

	/**
	 * Retrieves a single form by ID.
	 *
	 * @param int $id Form ID.
	 * @return array|false Form data or false on failure.
	 */
	public function get_form( $id ) {
		global $wpdb;
		$row = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$this->table_forms} WHERE id = %d", $id ), ARRAY_A );
		if ( ! $row ) {
			return false;
		}
		$row['fields'] = json_decode( $row['fields'], true );
		return $row;
	}

	/**
	 * Retrieves the active default form. Seeds one if it doesn't exist.
	 *
	 * @return array Default form details.
	 */
	public function get_default_form() {
		global $wpdb;
		$row = $wpdb->get_row( "SELECT * FROM {$this->table_forms} WHERE is_default = 1 LIMIT 1", ARRAY_A );
		
		if ( ! $row ) {
			// Seed a default form with Name, Email, Phone fields.
			$default_fields = array(
				array(
					'id'          => 'name',
					'type'        => 'text',
					'label'       => 'Name',
					'placeholder' => 'Enter your name...',
					'required'    => true,
					'order'       => 0,
					'enabled'     => true,
					'validation'  => 'none',
				),
				array(
					'id'          => 'email',
					'type'        => 'email',
					'label'       => 'Email',
					'placeholder' => 'Enter your email...',
					'required'    => true,
					'order'       => 1,
					'enabled'     => true,
					'validation'  => 'email',
				),
				array(
					'id'          => 'phone',
					'type'        => 'phone',
					'label'       => 'Phone',
					'placeholder' => 'Enter your phone...',
					'required'    => true,
					'order'       => 2,
					'enabled'     => true,
					'validation'  => 'phone',
				)
			);

			$wpdb->insert(
				$this->table_forms,
				array(
					'name'       => esc_html__( 'Default Pre-Chat Form', 'chat-pilot' ),
					'fields'     => wp_json_encode( $default_fields ),
					'is_default' => 1,
					'status'     => 'active',
					'created_at' => current_time( 'mysql' ),
					'updated_at' => current_time( 'mysql' ),
				),
				array( '%s', '%s', '%d', '%s', '%s', '%s' )
			);

			$row = $wpdb->get_row( "SELECT * FROM {$this->table_forms} WHERE is_default = 1 LIMIT 1", ARRAY_A );
		}

		$row['fields'] = json_decode( $row['fields'], true );
		return $row;
	}

	/**
	 * Creates a new form.
	 *
	 * @param string $name       Form name.
	 * @param array  $fields     Fields configuration.
	 * @param bool   $is_default Set as default form.
	 * @return int|false Inserted Form ID or false on failure.
	 */
	public function create_form( $name, $fields = array(), $is_default = false ) {
		global $wpdb;
		
		$is_default_val = $is_default ? 1 : 0;
		if ( $is_default_val ) {
			// Unset any previous defaults.
			$wpdb->query( "UPDATE {$this->table_forms} SET is_default = 0" );
		}

		$inserted = $wpdb->insert(
			$this->table_forms,
			array(
				'name'       => sanitize_text_field( $name ),
				'fields'     => wp_json_encode( $fields ),
				'is_default' => $is_default_val,
				'status'     => 'active',
				'created_at' => current_time( 'mysql' ),
				'updated_at' => current_time( 'mysql' ),
			),
			array( '%s', '%s', '%d', '%s', '%s', '%s' )
		);

		return $inserted ? $wpdb->insert_id : false;
	}

	/**
	 * Updates a form.
	 *
	 * @param int   $id   Form ID.
	 * @param array $data Fields to update.
	 * @return bool True on success, false on failure.
	 */
	public function update_form( $id, $data ) {
		global $wpdb;

		$update_payload = array(
			'updated_at' => current_time( 'mysql' ),
		);

		if ( isset( $data['name'] ) ) {
			$update_payload['name'] = sanitize_text_field( $data['name'] );
		}
		if ( isset( $data['fields'] ) ) {
			$update_payload['fields'] = wp_json_encode( $data['fields'] );
		}
		if ( isset( $data['status'] ) ) {
			$update_payload['status'] = sanitize_key( $data['status'] );
		}

		$updated = $wpdb->update(
			$this->table_forms,
			$update_payload,
			array( 'id' => $id ),
			null,
			array( '%d' )
		);

		return $updated !== false;
	}

	/**
	 * Sets a form as default.
	 *
	 * @param int $id Form ID.
	 * @return bool True on success.
	 */
	public function set_default_form( $id ) {
		global $wpdb;
		$wpdb->query( "UPDATE {$this->table_forms} SET is_default = 0" );
		$updated = $wpdb->update(
			$this->table_forms,
			array( 'is_default' => 1 ),
			array( 'id' => $id ),
			array( '%d' ),
			array( '%d' )
		);
		return $updated !== false;
	}

	/**
	 * Duplicates a form.
	 *
	 * @param int $id Form ID.
	 * @return int|false New Form ID or false on failure.
	 */
	public function duplicate_form( $id ) {
		$form = $this->get_form( $id );
		if ( ! $form ) {
			return false;
		}

		$new_name = sprintf( esc_html__( 'Copy of %s', 'chat-pilot' ), $form['name'] );
		return $this->create_form( $new_name, $form['fields'], false );
	}

	/**
	 * Deletes a form.
	 *
	 * @param int $id Form ID.
	 * @return bool True on success.
	 */
	public function delete_form( $id ) {
		global $wpdb;
		
		// If it's default, we cannot delete it unless there is another form we can make default.
		$form = $this->get_form( $id );
		if ( $form && $form['is_default'] ) {
			// Find another form.
			$other = $wpdb->get_var( $wpdb->prepare( "SELECT id FROM {$this->table_forms} WHERE id != %d LIMIT 1", $id ) );
			if ( $other ) {
				$this->set_default_form( $other );
			} else {
				return false; // Can't delete the only form.
			}
		}

		$deleted = $wpdb->delete( $this->table_forms, array( 'id' => $id ), array( '%d' ) );
		return $deleted !== false;
	}

	/**
	 * Saves a form submission.
	 *
	 * @param int    $form_id    Form ID.
	 * @param array  $fields     Key-value fields values map.
	 * @param string $session_id Visitor session identifier.
	 * @param string $page_url   URL submitted from.
	 * @return int|false Submission ID or false on failure.
	 */
	public function save_submission( $form_id, $fields, $session_id = '', $page_url = '' ) {
		global $wpdb;

		// Extract base contact details if present.
		$name  = isset( $fields['name'] ) ? sanitize_text_field( $fields['name'] ) : '';
		$email = isset( $fields['email'] ) ? sanitize_email( $fields['email'] ) : '';
		$phone = isset( $fields['phone'] ) ? sanitize_text_field( $fields['phone'] ) : '';

		// Strip base fields out of custom array to avoid duplicate data storage.
		$custom = $fields;
		unset( $custom['name'], $custom['email'], $custom['phone'] );

		// Clean up custom fields.
		$sanitized_custom = array();
		foreach ( $custom as $k => $v ) {
			if ( is_array( $v ) ) {
				$sanitized_custom[ sanitize_key( $k ) ] = array_map( 'sanitize_text_field', $v );
			} else {
				$sanitized_custom[ sanitize_key( $k ) ] = sanitize_text_field( $v );
			}
		}

		// Check if conversation already exists for this exact session
		$conv_id = 0;
		if ( ! empty( $session_id ) ) {
			$conv_table = $wpdb->prefix . 'chat_pilot_conversations';
			$conv_row   = $wpdb->get_row( $wpdb->prepare( "SELECT id FROM {$conv_table} WHERE session_id = %s LIMIT 1", sanitize_text_field( $session_id ) ), ARRAY_A );
			if ( $conv_row ) {
				$conv_id = intval( $conv_row['id'] );
			}
		}

		$inserted = $wpdb->insert(
			$this->table_submissions,
			array(
				'form_id'         => intval( $form_id ),
				'name'            => $name,
				'email'           => $email,
				'phone'           => $phone,
				'custom_fields'   => wp_json_encode( $sanitized_custom ),
				'session_id'      => sanitize_text_field( $session_id ),
				'conversation_id' => $conv_id,
				'page_url'        => esc_url_raw( $page_url ),
				'created_at'      => current_time( 'mysql' ),
			),
			array( '%d', '%s', '%s', '%s', '%s', '%s', '%d', '%s', '%s' )
		);

		return $inserted ? $wpdb->insert_id : false;
	}

	/**
	 * Associates a submission record with a conversation ID strictly by session_id.
	 *
	 * @param string $session_id Visitor session token.
	 * @param int    $conversation_id Conversation ID.
	 * @param string $visitor_email Unused fallback.
	 * @return bool True if updated.
	 */
	public function associate_submission_with_conversation( $session_id, $conversation_id, $visitor_email = '' ) {
		global $wpdb;
		if ( empty( $session_id ) || empty( $conversation_id ) ) {
			return false;
		}

		$res = $wpdb->update(
			$this->table_submissions,
			array( 'conversation_id' => intval( $conversation_id ) ),
			array( 'session_id' => sanitize_text_field( $session_id ) ),
			array( '%d' ),
			array( '%s' )
		);

		return false !== $res;
	}

	/**
	 * Retrieves form submissions with filters.
	 *
	 * @param array $args Filter arguments.
	 * @return array Submissions list.
	 */
	public function get_submissions( $args = array() ) {
		global $wpdb;

		$where  = array( '1=1' );
		$params = array();

		if ( ! empty( $args['form_id'] ) ) {
			$where[]  = 'form_id = %d';
			$params[] = intval( $args['form_id'] );
		}
		if ( ! empty( $args['search'] ) ) {
			$search   = '%' . $wpdb->esc_like( sanitize_text_field( $args['search'] ) ) . '%';
			$where[]  = '(name LIKE %s OR email LIKE %s OR phone LIKE %s OR custom_fields LIKE %s OR session_id LIKE %s)';
			$params[] = $search;
			$params[] = $search;
			$params[] = $search;
			$params[] = $search;
			$params[] = $search;
		}
		if ( ! empty( $args['date_from'] ) ) {
			$where[]  = 'created_at >= %s';
			$params[] = sanitize_text_field( $args['date_from'] ) . ' 00:00:00';
		}
		if ( ! empty( $args['date_to'] ) ) {
			$where[]  = 'created_at <= %s';
			$params[] = sanitize_text_field( $args['date_to'] ) . ' 23:59:59';
		}

		$where_sql = implode( ' AND ', $where );
		
		if ( ! empty( $params ) ) {
			$sql = $wpdb->prepare( "SELECT * FROM {$this->table_submissions} WHERE {$where_sql} ORDER BY id DESC", $params );
		} else {
			$sql = "SELECT * FROM {$this->table_submissions} WHERE {$where_sql} ORDER BY id DESC";
		}

		$results = $wpdb->get_results( $sql, ARRAY_A );

		foreach ( $results as &$row ) {
			$row['custom_fields'] = json_decode( $row['custom_fields'], true );
		}

		return $results;
	}

	/**
	 * Retrieves a single submission by ID.
	 *
	 * @param int $id Submission ID.
	 * @return array|false Submission data or false.
	 */
	public function get_submission( $id ) {
		global $wpdb;
		$row = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$this->table_submissions} WHERE id = %d", $id ), ARRAY_A );
		if ( ! $row ) {
			return false;
		}
		$row['custom_fields'] = json_decode( $row['custom_fields'], true );
		return $row;
	}

	/**
	 * Deletes a submission.
	 *
	 * @param int $id Submission ID.
	 * @return bool True on success.
	 */
	public function delete_submission( $id ) {
		global $wpdb;
		$deleted = $wpdb->delete( $this->table_submissions, array( 'id' => $id ), array( '%d' ) );
		return $deleted !== false;
	}
}
