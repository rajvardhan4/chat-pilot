<?php
namespace ChatPilot\Analytics;

// Prevent direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class AnalyticsManager
 * The core reporting, metrics, cost calculation, and telemetry engine for Chat Pilot.
 */
class AnalyticsManager {

	/**
	 * Pricing rules matrix per 1,000,000 tokens.
	 *
	 * @var array
	 */
	private $pricing_rules = array(
		'gpt-4o'              => array( 'input' => 2.50, 'output' => 10.00 ),
		'gpt-4o-mini'         => array( 'input' => 0.15, 'output' => 0.60 ),
		'gpt-4-turbo'         => array( 'input' => 10.00, 'output' => 30.00 ),
		'gpt-4'               => array( 'input' => 30.00, 'output' => 60.00 ),
		'gpt-3.5-turbo'       => array( 'input' => 0.50, 'output' => 1.50 ),
		'o1'                  => array( 'input' => 15.00, 'output' => 60.00 ),
		'gemini-3.6-flash'    => array( 'input' => 0.10, 'output' => 0.40 ),
		'gemini-3.5-flash'    => array( 'input' => 0.10, 'output' => 0.40 ),
		'gemini-3.5-flash-lite'=> array( 'input' => 0.05, 'output' => 0.20 ),
		'gemini-flash-latest' => array( 'input' => 0.10, 'output' => 0.40 ),
		'gemini-1.5-flash'    => array( 'input' => 0.075, 'output' => 0.30 ),
		'gemini-2.0-flash'    => array( 'input' => 0.10, 'output' => 0.40 ),
		'gemini-1.5-pro'      => array( 'input' => 1.25, 'output' => 5.00 ),
		'gemini-pro'          => array( 'input' => 0.50, 'output' => 1.50 ),
		'default'             => array( 'input' => 1.00, 'output' => 3.00 ),
	);

	/**
	 * Calculates estimated AI cost for a request based on input/output tokens.
	 *
	 * @param string $provider Provider slug.
	 * @param string $model    Model identifier string.
	 * @param int    $input    Input tokens.
	 * @param int    $output   Output tokens.
	 * @return float Estimated cost in USD.
	 */
	public function calculate_cost( $provider, $model, $input, $output ) {
		$model_key = strtolower( trim( $model ) );
		$rules     = isset( $this->pricing_rules[ $model_key ] ) ? $this->pricing_rules[ $model_key ] : null;

		if ( ! $rules ) {
			// Check partial match (e.g. gpt-4o-2024-05-13)
			foreach ( $this->pricing_rules as $k => $rate ) {
				if ( 'default' !== $k && strpos( $model_key, $k ) !== false ) {
					$rules = $rate;
					break;
				}
			}
		}

		if ( ! $rules ) {
			$rules = $this->pricing_rules['default'];
		}

		$input_cost  = ( intval( $input ) / 1000000.0 ) * $rules['input'];
		$output_cost = ( intval( $output ) / 1000000.0 ) * $rules['output'];

		return round( $input_cost + $output_cost, 6 );
	}

	/**
	 * Fetches comprehensive analytics data payload.
	 *
	 * @param array $args Filter options array.
	 * @return array Processed analytics structure.
	 */
	public function get_analytics_data( $args = array() ) {
		global $wpdb;

		$plugin = \ChatPilot\Core\Plugin::instance();

		// Parse date range
		$date_range = ! empty( $args['date_range'] ) ? sanitize_key( $args['date_range'] ) : '30days';
		$now_ts     = current_time( 'timestamp' );
		$today_str  = date( 'Y-m-d', $now_ts );

		$date_from = ! empty( $args['date_from'] ) ? sanitize_text_field( $args['date_from'] ) : '';
		$date_to   = ! empty( $args['date_to'] ) ? sanitize_text_field( $args['date_to'] ) : '';

		if ( 'today' === $date_range ) {
			$start_date = $today_str;
			$end_date   = $today_str;
		} elseif ( '7days' === $date_range ) {
			$start_date = date( 'Y-m-d', strtotime( '-6 days', $now_ts ) );
			$end_date   = $today_str;
		} elseif ( '30days' === $date_range ) {
			$start_date = date( 'Y-m-d', strtotime( '-29 days', $now_ts ) );
			$end_date   = $today_str;
		} elseif ( 'custom' === $date_range && ( $date_from || $date_to ) ) {
			$start_date = $date_from ? $date_from : '2000-01-01';
			$end_date   = $date_to ? $date_to : $today_str;
		} else {
			$start_date = date( 'Y-m-d', strtotime( '-29 days', $now_ts ) );
			$end_date   = $today_str;
		}

		$filter_provider = ! empty( $args['provider'] ) ? sanitize_key( $args['provider'] ) : 'all';
		$filter_model    = ! empty( $args['model'] ) ? sanitize_text_field( $args['model'] ) : 'all';
		$filter_source   = ! empty( $args['source'] ) ? sanitize_key( $args['source'] ) : 'all';
		$filter_form_id  = ! empty( $args['form_id'] ) ? intval( $args['form_id'] ) : 0;
		$filter_status   = ! empty( $args['status'] ) ? sanitize_key( $args['status'] ) : 'all';

		// Query Conversations
		$conv_table = $wpdb->prefix . 'chat_pilot_conversations';
		$conv_where = array( 'created_at >= %s', 'created_at <= %s' );
		$conv_params = array( $start_date . ' 00:00:00', $end_date . ' 23:59:59' );

		if ( 'all' !== $filter_source ) {
			$conv_where[]  = 'source = %s';
			$conv_params[] = $filter_source;
		}
		if ( $filter_form_id > 0 ) {
			$conv_where[]  = 'form_id = %d';
			$conv_params[] = $filter_form_id;
		}
		if ( 'all' !== $filter_status ) {
			$conv_where[]  = 'status = %s';
			$conv_params[] = $filter_status;
		}

		$sql_convs = $wpdb->prepare(
			"SELECT * FROM {$conv_table} WHERE " . implode( ' AND ', $conv_where ) . " ORDER BY created_at ASC",
			$conv_params
		);

		$conversations = $wpdb->get_results( $sql_convs, ARRAY_A );

		// Query Form Submissions
		$sub_table  = $wpdb->prefix . 'chat_pilot_form_submissions';
		$sub_where  = array( 'created_at >= %s', 'created_at <= %s' );
		$sub_params = array( $start_date . ' 00:00:00', $end_date . ' 23:59:59' );

		if ( $filter_form_id > 0 ) {
			$sub_where[]  = 'form_id = %d';
			$sub_params[] = $filter_form_id;
		}

		$sql_subs = $wpdb->prepare(
			"SELECT * FROM {$sub_table} WHERE " . implode( ' AND ', $sub_where ) . " ORDER BY created_at ASC",
			$sub_params
		);

		$submissions = $wpdb->get_results( $sql_subs, ARRAY_A );

		// Query Month-to-date Conversations for Budget calculation
		$month_start = date( 'Y-m-01 00:00:00', $now_ts );
		$month_end   = date( 'Y-m-t 23:59:59', $now_ts );
		$sql_mtd     = $wpdb->prepare(
			"SELECT * FROM {$conv_table} WHERE created_at >= %s AND created_at <= %s",
			$month_start,
			$month_end
		);
		$mtd_conversations = $wpdb->get_results( $sql_mtd, ARRAY_A );

		// Query Today Conversations for Today Cost
		$today_start = $today_str . ' 00:00:00';
		$today_end   = $today_str . ' 23:59:59';
		$sql_today   = $wpdb->prepare(
			"SELECT * FROM {$conv_table} WHERE created_at >= %s AND created_at <= %s",
			$today_start,
			$today_end
		);
		$today_conversations = $wpdb->get_results( $sql_today, ARRAY_A );

		// Initialize Data Accumulators
		$total_convs       = count( $conversations );
		$active_convs      = 0;
		$completed_convs   = 0;
		$total_messages    = 0;
		$total_duration_s  = 0;
		$duration_count    = 0;

		$visitor_sessions  = array();
		$visitor_map       = array();

		$total_ai_requests = 0;
		$success_requests  = 0;
		$failed_requests   = 0;
		$provider_errors   = 0;
		$quota_errors      = 0;
		$auth_errors       = 0;
		$timeout_errors    = 0;
		$model_errors      = 0;
		$total_latency_ms  = 0.0;
		$widget_requests   = 0;
		$dev_requests      = 0;

		$total_input_tokens  = 0;
		$total_output_tokens = 0;
		$total_tokens        = 0;

		$total_cost          = 0.0;
		$widget_cost         = 0.0;
		$dev_cost            = 0.0;

		$provider_stats = array();
		$model_stats    = array();

		$faq_retrievals      = 0;
		$manual_retrievals   = 0;
		$doc_retrievals      = 0;
		$website_retrievals  = 0;
		$fallback_retrievals = 0;
		$total_retrievals    = 0;
		$sum_similarity      = 0.0;
		$similarity_count    = 0;

		// Date trend map generator
		$date_trends = array();
		$dt_curr     = strtotime( $start_date );
		$dt_end      = strtotime( $end_date );

		while ( $dt_curr <= $dt_end ) {
			$d_key = date( 'Y-m-d', $dt_curr );
			$date_trends[ $d_key ] = array(
				'date'          => $d_key,
				'label'         => date( 'M j', $dt_curr ),
				'conversations' => 0,
				'leads'         => 0,
				'ai_requests'   => 0,
				'input_tokens'  => 0,
				'output_tokens' => 0,
				'total_tokens'  => 0,
				'cost'          => 0.0,
			);
			$dt_curr = strtotime( '+1 day', $dt_curr );
		}

		// Process Conversations & Telemetry Requests
		foreach ( $conversations as $c ) {
			$st = isset( $c['status'] ) ? $c['status'] : 'active';
			if ( 'active' === $st ) {
				$active_convs++;
			} elseif ( 'completed' === $st ) {
				$completed_convs++;
			}

			$msgs = ! empty( $c['messages'] ) ? ( is_array( $c['messages'] ) ? $c['messages'] : json_decode( $c['messages'], true ) ) : array();
			$msgs_count = count( $msgs );
			$total_messages += $msgs_count;

			// Duration calculation
			if ( ! empty( $c['created_at'] ) && ! empty( $c['updated_at'] ) ) {
				$c_start = strtotime( $c['created_at'] );
				$c_end   = strtotime( $c['updated_at'] );
				if ( $c_end >= $c_start ) {
					$total_duration_s += ( $c_end - $c_start );
					$duration_count++;
				}
			}

			// Visitor Identification key
			$v_key = ! empty( $c['visitor_email'] ) ? strtolower( $c['visitor_email'] ) : ( ! empty( $c['visitor_name'] ) ? strtolower( $c['visitor_name'] ) : $c['session_id'] );
			$is_anon = empty( $c['visitor_email'] ) && empty( $c['visitor_name'] );

			if ( ! isset( $visitor_map[ $v_key ] ) ) {
				$visitor_map[ $v_key ] = array(
					'key'          => $v_key,
					'name'         => ! empty( $c['visitor_name'] ) ? $c['visitor_name'] : ( $is_anon ? 'Anonymous Visitor' : 'Visitor' ),
					'email'        => $c['visitor_email'],
					'phone'        => $c['visitor_phone'],
					'is_anonymous' => $is_anon,
					'conv_count'   => 0,
					'req_count'    => 0,
					'input_tokens' => 0,
					'output_tokens'=> 0,
					'total_tokens' => 0,
					'cost'         => 0.0,
				);
			}
			$visitor_map[ $v_key ]['conv_count']++;

			// Day key for trends
			$day_key = date( 'Y-m-d', strtotime( $c['created_at'] ) );
			if ( isset( $date_trends[ $day_key ] ) ) {
				$date_trends[ $day_key ]['conversations']++;
			}

			// Extract AI requests from metadata
			$meta = ! empty( $c['metadata'] ) ? ( is_array( $c['metadata'] ) ? $c['metadata'] : json_decode( $c['metadata'], true ) ) : array();
			$ai_requests = array();

			if ( isset( $meta['ai_requests'] ) && is_array( $meta['ai_requests'] ) ) {
				$ai_requests = $meta['ai_requests'];
			} elseif ( isset( $meta['provider'] ) ) {
				$ai_requests = array( $meta );
			}

			foreach ( $ai_requests as $req ) {
				$p_slug = ! empty( $req['provider'] ) ? sanitize_key( $req['provider'] ) : 'none';
				$m_id   = ! empty( $req['model'] ) ? sanitize_text_field( $req['model'] ) : 'none';
				$source = ! empty( $req['source'] ) ? sanitize_key( $req['source'] ) : $c['source'];

				// Filter checking by provider / model
				if ( 'all' !== $filter_provider && $p_slug !== $filter_provider ) {
					continue;
				}
				if ( 'all' !== $filter_model && $m_id !== $filter_model ) {
					continue;
				}

				$total_ai_requests++;

				$is_failed = ! empty( $req['error'] ) || ! empty( $req['is_provider_error'] );
				if ( ! $is_failed ) {
					$success_requests++;
				} else {
					$failed_requests++;
					$provider_errors++;

					$err_type = ! empty( $req['error_type'] ) ? $req['error_type'] : '';
					$err_str  = strtolower( ( ! empty( $req['error'] ) ? $req['error'] : '' ) . ' ' . $err_type );

					if ( 'quota_exceeded' === $err_type || strpos( $err_str, 'quota' ) !== false || strpos( $err_str, '429' ) !== false || strpos( $err_str, 'resource_exhausted' ) !== false || strpos( $err_str, 'rate limit' ) !== false || strpos( $err_str, 'rate_limit' ) !== false || strpos( $err_str, 'insufficient_quota' ) !== false ) {
						$quota_errors++;
					} elseif ( 'authentication_error' === $err_type || strpos( $err_str, 'key' ) !== false || strpos( $err_str, 'unauthorized' ) !== false || strpos( $err_str, '401' ) !== false || strpos( $err_str, '403' ) !== false ) {
						$auth_errors++;
					} elseif ( 'timeout_error' === $err_type || strpos( $err_str, 'timeout' ) !== false || strpos( $err_str, 'timed out' ) !== false ) {
						$timeout_errors++;
					} else {
						$model_errors++;
					}
				}

				$lat = isset( $req['latency'] ) ? floatval( $req['latency'] ) : ( isset( $req['latency_ms'] ) ? floatval( $req['latency_ms'] ) : 0.0 );
				$total_latency_ms += $lat;

				if ( 'playground' === $source ) {
					$dev_requests++;
				} else {
					$widget_requests++;
				}

				// Tokens: for failed requests, do not fabricate tokens if provider didn't return usage
				$in_tok  = isset( $req['input_tokens'] ) ? intval( $req['input_tokens'] ) : 0;
				$out_tok = isset( $req['output_tokens'] ) ? intval( $req['output_tokens'] ) : 0;
				$tot_tok = isset( $req['tokens'] ) ? intval( $req['tokens'] ) : ( $in_tok + $out_tok );

				if ( ! $is_failed && 0 === $tot_tok && isset( $req['prompt_size'] ) ) {
					$in_tok  = (int) ceil( intval( $req['prompt_size'] ) / 4 );
					$out_tok = (int) ceil( ( isset( $req['completion_size'] ) ? intval( $req['completion_size'] ) : 100 ) / 4 );
					$tot_tok = $in_tok + $out_tok;
				}

				$total_input_tokens  += $in_tok;
				$total_output_tokens += $out_tok;
				$total_tokens        += $tot_tok;

				// Cost calculation: 0 cost if 0 tokens used
				$req_cost = ( $tot_tok > 0 ) ? $this->calculate_cost( $p_slug, $m_id, $in_tok, $out_tok ) : 0.0;
				$total_cost += $req_cost;

				if ( 'playground' === $source ) {
					$dev_cost += $req_cost;
				} else {
					$widget_cost += $req_cost;
				}

				// Visitor stats update
				$visitor_map[ $v_key ]['req_count']++;
				$visitor_map[ $v_key ]['input_tokens']  += $in_tok;
				$visitor_map[ $v_key ]['output_tokens'] += $out_tok;
				$visitor_map[ $v_key ]['total_tokens']  += $tot_tok;
				$visitor_map[ $v_key ]['cost']          += $req_cost;

				// Provider stats update
				if ( ! isset( $provider_stats[ $p_slug ] ) ) {
					$provider_info = $plugin->providers->get_provider( $p_slug );
					$provider_name = $provider_info ? $provider_info->getProviderInformation()['name'] : ucfirst( $p_slug );

					$provider_stats[ $p_slug ] = array(
						'slug'          => $p_slug,
						'name'          => $provider_name,
						'requests'      => 0,
						'input_tokens'  => 0,
						'output_tokens' => 0,
						'total_tokens'  => 0,
						'cost'          => 0.0,
					);
				}
				$provider_stats[ $p_slug ]['requests']++;
				$provider_stats[ $p_slug ]['input_tokens']  += $in_tok;
				$provider_stats[ $p_slug ]['output_tokens'] += $out_tok;
				$provider_stats[ $p_slug ]['total_tokens']  += $tot_tok;
				$provider_stats[ $p_slug ]['cost']          += $req_cost;

				// Model stats update
				$model_key = $p_slug . '::' . $m_id;
				if ( ! isset( $model_stats[ $model_key ] ) ) {
					$model_stats[ $model_key ] = array(
						'provider'      => $provider_stats[ $p_slug ]['name'],
						'model'         => $m_id,
						'requests'      => 0,
						'input_tokens'  => 0,
						'output_tokens' => 0,
						'total_tokens'  => 0,
						'cost'          => 0.0,
						'total_latency' => 0.0,
					);
				}
				$model_stats[ $model_key ]['requests']++;
				$model_stats[ $model_key ]['input_tokens']  += $in_tok;
				$model_stats[ $model_key ]['output_tokens'] += $out_tok;
				$model_stats[ $model_key ]['total_tokens']  += $tot_tok;
				$model_stats[ $model_key ]['cost']          += $req_cost;
				$model_stats[ $model_key ]['total_latency'] += $lat;

				// KB Retrieval Telemetry
				if ( isset( $req['intent'] ) && 'knowledge' === $req['intent'] ) {
					$total_retrievals++;
					$s_used = isset( $req['sources_used'] ) ? $req['sources_used'] : 'None';
					$s_type = isset( $req['source_type'] ) ? strtolower( $req['source_type'] ) : 'none';
					$conf   = isset( $req['confidence_status'] ) ? $req['confidence_status'] : '';

					if ( 'Fallback' === $conf || 'none' === $s_type || 'None' === $s_used ) {
						$fallback_retrievals++;
					} else {
						if ( isset( $req['retrieved_sources'] ) && is_array( $req['retrieved_sources'] ) ) {
							if ( ! empty( $req['retrieved_sources']['faq'] ) ) $faq_retrievals++;
							if ( ! empty( $req['retrieved_sources']['manual'] ) ) $manual_retrievals++;
							if ( ! empty( $req['retrieved_sources']['file'] ) ) $doc_retrievals++;
							if ( ! empty( $req['retrieved_sources']['website'] ) ) $website_retrievals++;
						} else {
							if ( strpos( $s_type, 'faq' ) !== false ) $faq_retrievals++;
							elseif ( strpos( $s_type, 'manual' ) !== false ) $manual_retrievals++;
							elseif ( strpos( $s_type, 'file' ) !== false || strpos( $s_type, 'docx' ) !== false || strpos( $s_type, 'pdf' ) !== false ) $doc_retrievals++;
							elseif ( strpos( $s_type, 'website' ) !== false ) $website_retrievals++;
						}
					}

					if ( isset( $req['similarity_score'] ) && floatval( $req['similarity_score'] ) > 0 ) {
						$sum_similarity += floatval( $req['similarity_score'] );
						$similarity_count++;
					}
				}

				// Trend point update
				$req_day = ! empty( $req['timestamp'] ) ? date( 'Y-m-d', strtotime( $req['timestamp'] ) ) : $day_key;
				if ( isset( $date_trends[ $req_day ] ) ) {
					$date_trends[ $req_day ]['ai_requests']++;
					$date_trends[ $req_day ]['input_tokens']  += $in_tok;
					$date_trends[ $req_day ]['output_tokens'] += $out_tok;
					$date_trends[ $req_day ]['total_tokens']  += $tot_tok;
					$date_trends[ $req_day ]['cost']          += $req_cost;
				}
			}
		}

		// Process Submissions (Leads)
		$total_leads     = count( $submissions );
		$name_sub_count  = 0;
		$email_sub_count = 0;
		$phone_sub_count = 0;

		foreach ( $submissions as $sub ) {
			if ( ! empty( $sub['name'] ) ) $name_sub_count++;
			if ( ! empty( $sub['email'] ) ) $email_sub_count++;
			if ( ! empty( $sub['phone'] ) ) $phone_sub_count++;

			$sub_day = date( 'Y-m-d', strtotime( $sub['created_at'] ) );
			if ( isset( $date_trends[ $sub_day ] ) ) {
				$date_trends[ $sub_day ]['leads']++;
			}
		}

		// Calculate MTD & Today Cost
		$cost_mtd   = 0.0;
		$cost_today = 0.0;

		foreach ( $mtd_conversations as $c_mtd ) {
			$meta_mtd = ! empty( $c_mtd['metadata'] ) ? ( is_array( $c_mtd['metadata'] ) ? $c_mtd['metadata'] : json_decode( $c_mtd['metadata'], true ) ) : array();
			$reqs_mtd = isset( $meta_mtd['ai_requests'] ) ? $meta_mtd['ai_requests'] : ( isset( $meta_mtd['provider'] ) ? array( $meta_mtd ) : array() );

			foreach ( $reqs_mtd as $r_mtd ) {
				$p = ! empty( $r_mtd['provider'] ) ? $r_mtd['provider'] : 'none';
				$m = ! empty( $r_mtd['model'] ) ? $r_mtd['model'] : 'none';
				$in_t  = isset( $r_mtd['input_tokens'] ) ? intval( $r_mtd['input_tokens'] ) : 0;
				$out_t = isset( $r_mtd['output_tokens'] ) ? intval( $r_mtd['output_tokens'] ) : 0;
				$cost_mtd += $this->calculate_cost( $p, $m, $in_t, $out_t );
			}
		}

		foreach ( $today_conversations as $c_tod ) {
			$meta_tod = ! empty( $c_tod['metadata'] ) ? ( is_array( $c_tod['metadata'] ) ? $c_tod['metadata'] : json_decode( $c_tod['metadata'], true ) ) : array();
			$reqs_tod = isset( $meta_tod['ai_requests'] ) ? $meta_tod['ai_requests'] : ( isset( $meta_tod['provider'] ) ? array( $meta_tod ) : array() );

			foreach ( $reqs_tod as $r_tod ) {
				$p = ! empty( $r_tod['provider'] ) ? $r_tod['provider'] : 'none';
				$m = ! empty( $r_tod['model'] ) ? $r_tod['model'] : 'none';
				$in_t  = isset( $r_tod['input_tokens'] ) ? intval( $r_tod['input_tokens'] ) : 0;
				$out_t = isset( $r_tod['output_tokens'] ) ? intval( $r_tod['output_tokens'] ) : 0;
				$cost_today += $this->calculate_cost( $p, $m, $in_t, $out_t );
			}
		}

		// Budget & Warning Calculations
		$monthly_budget = floatval( $plugin->settings->get( 'analytics.monthly_budget', 100.00 ) );
		if ( $monthly_budget <= 0 ) {
			$monthly_budget = 100.00;
		}

		$warning_setting = floatval( $plugin->settings->get( 'analytics.warning_threshold', 80 ) );
		if ( $warning_setting <= 0 ) {
			$warning_setting = 80;
		}

		// Calculate Remaining Budget dynamically for the selected period
		$period_cost      = $total_cost;
		$remaining_budget = max( 0.0, $monthly_budget - $period_cost );
		$exceeded_amount  = max( 0.0, $period_cost - $monthly_budget );
		$is_over_budget   = ( $period_cost > $monthly_budget );
		$usage_pct        = ( $monthly_budget > 0 ) ? round( ( $period_cost / $monthly_budget ) * 100, 1 ) : 0.0;

		$warning_status = 'none';
		$warning_label  = '';
		if ( $is_over_budget ) {
			$warning_status = 'over_budget';
			$warning_label  = sprintf(
				esc_html__( 'CAUTION: Monthly AI Budget Exceeded by $%.2f (%.1f%% used - $%.4f / $%.2f)', 'chat-pilot' ),
				$exceeded_amount,
				$usage_pct,
				$period_cost,
				$monthly_budget
			);
		} elseif ( $usage_pct >= 100.0 ) {
			$warning_status = '100%';
			$warning_label  = sprintf(
				esc_html__( 'CAUTION: Monthly AI Budget Reached (100%% used - $%.4f / $%.2f)', 'chat-pilot' ),
				$period_cost,
				$monthly_budget
			);
		} elseif ( $usage_pct >= $warning_setting ) {
			$warning_status = 'warning';
			$warning_label  = sprintf(
				esc_html__( 'WARNING: AI Budget at %.1f%% Capacity ($%.4f / $%.2f - Threshold: %d%%)', 'chat-pilot' ),
				$usage_pct,
				$period_cost,
				$monthly_budget,
				intval( $warning_setting )
			);
		}

		// Final Model Stats Average Latency formatting
		$formatted_models = array();
		foreach ( $model_stats as $m_item ) {
			$m_item['avg_latency'] = $m_item['requests'] > 0 ? round( $m_item['total_latency'] / $m_item['requests'], 2 ) : 0.0;
			$m_item['cost_fmt']    = '$' . number_format( $m_item['cost'], 4 );
			$formatted_models[]    = $m_item;
		}

		// Final Visitor List Formatting
		$formatted_visitors = array_values( $visitor_map );
		usort( $formatted_visitors, function( $a, $b ) {
			return $b['cost'] <=> $a['cost'];
		} );

		$total_visitors = count( $formatted_visitors );
		$new_visitors = 0;
		$returning_visitors = 0;
		foreach ( $formatted_visitors as $v ) {
			if ( $v['conv_count'] > 1 ) {
				$returning_visitors++;
			} else {
				$new_visitors++;
			}
		}

		$conversion_rate = $total_visitors > 0 ? round( ( $total_leads / $total_visitors ) * 100, 1 ) : 0.0;
		$kb_success_rate = $total_retrievals > 0 ? round( ( ( $total_retrievals - $fallback_retrievals ) / $total_retrievals ) * 100, 1 ) : 0.0;
		$kb_fallback_rate = $total_retrievals > 0 ? round( ( $fallback_retrievals / $total_retrievals ) * 100, 1 ) : 0.0;
		$avg_similarity   = $similarity_count > 0 ? round( $sum_similarity / $similarity_count, 2 ) : 0.0;

		// Query Provider Operational Health states
		$active_provider_slug = $plugin->settings->get( 'providers.active_provider', 'gemini' );
		$all_providers        = array( 'gemini', 'openai', 'openrouter' );
		$provider_health_map  = array();
		$active_provider_warning = null;

		foreach ( $all_providers as $p_slug ) {
			$p_instance = $plugin->providers->get_provider( $p_slug );
			$p_key      = $plugin->settings->get( "providers.{$p_slug}.api_key", '' );
			$p_name     = $p_instance ? $p_instance->getProviderInformation()['name'] : ucfirst( $p_slug );
			$is_configured = ! empty( $p_key );

			$health_opt = get_option( 'chat_pilot_provider_health_' . $p_slug, null );

			$op_status  = 'operational';
			$op_label   = 'Operational';
			$last_error = null;
			$last_time  = '';

			if ( is_array( $health_opt ) && ! empty( $health_opt['status'] ) ) {
				$op_status  = $health_opt['status'];
				$op_label   = ! empty( $health_opt['label'] ) ? $health_opt['label'] : ucfirst( str_replace( '_', ' ', $op_status ) );
				$last_error = ! empty( $health_opt['message'] ) ? $health_opt['message'] : null;
				$last_time  = ! empty( $health_opt['timestamp'] ) ? $health_opt['timestamp'] : '';
			}

			$p_health = array(
				'slug'                 => $p_slug,
				'name'                 => $p_name,
				'is_active'            => ( $p_slug === $active_provider_slug ),
				'is_configured'        => $is_configured,
				'configuration_status' => $is_configured ? 'Connected' : 'Not Configured',
				'operational_status'   => $op_status,
				'operational_label'    => $op_label,
				'last_error'           => $last_error,
				'last_error_time'      => $last_time,
				'retry_after'          => ! empty( $health_opt['retry_after'] ) ? $health_opt['retry_after'] : '',
			);

			$provider_health_map[ $p_slug ] = $p_health;

			if ( $p_slug === $active_provider_slug && in_array( $op_status, array( 'quota_exceeded', 'rate_limited', 'authentication_error', 'provider_error', 'timeout_error' ), true ) ) {
				$active_provider_warning = array(
					'provider'    => $p_name,
					'status'      => $op_status,
					'label'       => $op_label,
					'message'     => $last_error,
					'timestamp'   => $last_time,
					'retry_after' => ! empty( $health_opt['retry_after'] ) ? $health_opt['retry_after'] : '',
				);
			}
		}

		$ai_error_rate = $total_ai_requests > 0 ? round( ( $failed_requests / $total_ai_requests ) * 100, 1 ) : 0.0;

		return array(
			'date_range'  => array(
				'range'      => $date_range,
				'start_date' => $start_date,
				'end_date'   => $end_date,
			),
			'overview'    => array(
				'total_conversations'      => $total_convs,
				'active_conversations'     => $active_convs,
				'completed_conversations'  => $completed_convs,
				'total_visitors'           => $total_visitors,
				'total_leads'              => $total_leads,
				'total_ai_requests'        => $total_ai_requests,
				'successful_ai_requests'   => $success_requests,
				'failed_ai_requests'       => $failed_requests,
				'provider_errors'          => $provider_errors,
				'error_rate'               => $ai_error_rate,
				'total_tokens'             => $total_tokens,
				'total_input_tokens'       => $total_input_tokens,
				'total_output_tokens'      => $total_output_tokens,
				'estimated_cost'           => round( $total_cost, 4 ),
				'monthly_budget'           => $monthly_budget,
				'remaining_budget'         => round( $remaining_budget, 2 ),
				'remaining_budget_raw'     => round( $remaining_budget, 4 ),
				'exceeded_amount'          => round( $exceeded_amount, 2 ),
				'is_over_budget'           => $is_over_budget,
				'usage_pct'                => $usage_pct,
				'widget_cost'              => round( $widget_cost, 4 ),
				'dev_cost'                 => round( $dev_cost, 4 ),
			),
			'conversations' => array(
				'total'                => $total_convs,
				'active'               => $active_convs,
				'completed'            => $completed_convs,
				'avg_messages'         => $total_convs > 0 ? round( $total_messages / $total_convs, 1 ) : 0,
				'avg_duration_mins'    => $duration_count > 0 ? round( ( $total_duration_s / $duration_count ) / 60, 1 ) : 0,
				'new_visitors'         => $new_visitors,
				'returning_visitors'   => $returning_visitors,
			),
			'leads' => array(
				'total'            => $total_leads,
				'name_count'       => $name_sub_count,
				'email_count'      => $email_sub_count,
				'phone_count'      => $phone_sub_count,
				'conversion_rate'  => $conversion_rate,
			),
			'ai_requests' => array(
				'total'           => $total_ai_requests,
				'successful'      => $success_requests,
				'failed'          => $failed_requests,
				'provider_errors' => $provider_errors,
				'quota_errors'    => $quota_errors,
				'auth_errors'     => $auth_errors,
				'timeout_errors'  => $timeout_errors,
				'model_errors'    => $model_errors,
				'avg_latency'     => $total_ai_requests > 0 ? round( $total_latency_ms / $total_ai_requests, 2 ) : 0,
				'error_rate'      => $ai_error_rate,
				'widget_reqs'     => $widget_requests,
				'dev_reqs'        => $dev_requests,
			),
			'tokens' => array(
				'total'               => $total_tokens,
				'input'               => $total_input_tokens,
				'output'              => $total_output_tokens,
				'avg_input_per_req'   => $total_ai_requests > 0 ? round( $total_input_tokens / $total_ai_requests, 1 ) : 0,
				'avg_output_per_req'  => $total_ai_requests > 0 ? round( $total_output_tokens / $total_ai_requests, 1 ) : 0,
				'avg_per_conv'        => $total_convs > 0 ? round( $total_tokens / $total_convs, 1 ) : 0,
			),
			'costs' => array(
				'today'       => round( $cost_today, 4 ),
				'this_month'  => round( $cost_mtd, 4 ),
				'in_range'    => round( $total_cost, 4 ),
				'widget'      => round( $widget_cost, 4 ),
				'dev'         => round( $dev_cost, 4 ),
			),
			'providers'       => array_values( $provider_stats ),
			'provider_health' => array_values( $provider_health_map ),
			'provider_alert'  => $active_provider_warning,
			'models'          => $formatted_models,
			'visitors'        => array_slice( $formatted_visitors, 0, 50 ),
			'kb_performance'  => array(
				'faq_count'      => $faq_retrievals,
				'manual_count'   => $manual_retrievals,
				'doc_count'      => $doc_retrievals,
				'website_count'  => $website_retrievals,
				'fallback_count' => $fallback_retrievals,
				'total'          => $total_retrievals,
				'success_rate'   => $kb_success_rate,
				'fallback_rate'  => $kb_fallback_rate,
				'avg_similarity' => $avg_similarity,
			),
			'budget' => array(
				'monthly_budget'       => $monthly_budget,
				'used_cost'            => round( $period_cost, 4 ),
				'cost_mtd'             => round( $cost_mtd, 4 ),
				'remaining_budget'     => round( $remaining_budget, 2 ),
				'remaining_budget_raw' => round( $remaining_budget, 4 ),
				'exceeded_amount'      => round( $exceeded_amount, 2 ),
				'is_over_budget'       => $is_over_budget,
				'usage_pct'            => $usage_pct,
				'warning_setting'      => $warning_setting,
				'warning_status'       => $warning_status,
				'warning_label'        => $warning_label,
			),
			'trends' => array_values( $date_trends ),
		);
	}

	/**
	 * Generates CSV download for analytics report.
	 *
	 * @param array $args Filter options array.
	 */
	public function export_csv( $args = array() ) {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'Unauthorized user capability.', 'chat-pilot' ) );
		}

		$data = $this->get_analytics_data( $args );

		ob_clean();
		header( 'Content-Type: text/csv; charset=utf-8' );
		header( 'Content-Disposition: attachment; filename=chat-pilot-analytics-' . date( 'Y-m-d' ) . '.csv' );

		$out = fopen( 'php://output', 'w' );

		// Title Banner
		fputcsv( $out, array( 'CHAT PILOT ANALYTICS REPORT' ) );
		fputcsv( $out, array( 'Date Range', $data['date_range']['start_date'] . ' to ' . $data['date_range']['end_date'] ) );
		fputcsv( $out, array( 'Generated At', current_time( 'mysql' ) ) );
		fputcsv( $out, array() );

		// KPI Summary
		fputcsv( $out, array( 'EXECUTIVE KPI SUMMARY' ) );
		fputcsv( $out, array( 'Total Conversations', $data['overview']['total_conversations'] ) );
		fputcsv( $out, array( 'Active Conversations', $data['overview']['active_conversations'] ) );
		fputcsv( $out, array( 'Completed Conversations', $data['overview']['completed_conversations'] ) );
		fputcsv( $out, array( 'Total Visitors', $data['overview']['total_visitors'] ) );
		fputcsv( $out, array( 'Total Leads', $data['overview']['total_leads'] ) );
		fputcsv( $out, array( 'Total AI Requests', $data['overview']['total_ai_requests'] ) );
		fputcsv( $out, array( 'Total Input Tokens', $data['tokens']['input'] ) );
		fputcsv( $out, array( 'Total Output Tokens', $data['tokens']['output'] ) );
		fputcsv( $out, array( 'Total Tokens', $data['tokens']['total'] ) );
		fputcsv( $out, array( 'Estimated AI Cost (USD)', '$' . number_format( $data['overview']['estimated_cost'], 4 ) ) );
		fputcsv( $out, array( 'Monthly AI Budget (USD)', '$' . number_format( $data['budget']['monthly_budget'], 2 ) ) );
		fputcsv( $out, array( 'Estimated Remaining Budget (USD)', '$' . number_format( $data['budget']['remaining_budget'], 2 ) ) );
		fputcsv( $out, array() );

		// Usage Trends
		fputcsv( $out, array( 'DAILY USAGE TRENDS' ) );
		fputcsv( $out, array( 'Date', 'Conversations', 'Leads', 'AI Requests', 'Input Tokens', 'Output Tokens', 'Total Tokens', 'Estimated Cost ($)' ) );
		foreach ( $data['trends'] as $t ) {
			fputcsv( $out, array(
				$t['date'],
				$t['conversations'],
				$t['leads'],
				$t['ai_requests'],
				$t['input_tokens'],
				$t['output_tokens'],
				$t['total_tokens'],
				number_format( $t['cost'], 4 ),
			) );
		}
		fputcsv( $out, array() );

		// Provider Breakdown
		fputcsv( $out, array( 'PROVIDER BREAKDOWN' ) );
		fputcsv( $out, array( 'Provider', 'Requests', 'Input Tokens', 'Output Tokens', 'Total Tokens', 'Estimated Cost ($)' ) );
		foreach ( $data['providers'] as $p ) {
			fputcsv( $out, array(
				$p['name'],
				$p['requests'],
				$p['input_tokens'],
				$p['output_tokens'],
				$p['total_tokens'],
				number_format( $p['cost'], 4 ),
			) );
		}
		fputcsv( $out, array() );

		// Model Breakdown
		fputcsv( $out, array( 'MODEL BREAKDOWN' ) );
		fputcsv( $out, array( 'Provider', 'Model', 'Requests', 'Input Tokens', 'Output Tokens', 'Total Tokens', 'Avg Latency (ms)', 'Estimated Cost ($)' ) );
		foreach ( $data['models'] as $m ) {
			fputcsv( $out, array(
				$m['provider'],
				$m['model'],
				$m['requests'],
				$m['input_tokens'],
				$m['output_tokens'],
				$m['total_tokens'],
				$m['avg_latency'],
				number_format( $m['cost'], 4 ),
			) );
		}
		fputcsv( $out, array() );

		// Visitor Level
		fputcsv( $out, array( 'VISITOR USAGE TELEMETRY' ) );
		fputcsv( $out, array( 'Visitor Name', 'Email', 'Phone', 'Conversations', 'AI Requests', 'Input Tokens', 'Output Tokens', 'Total Tokens', 'Estimated Cost ($)' ) );
		foreach ( $data['visitors'] as $v ) {
			fputcsv( $out, array(
				$v['name'],
				$v['email'],
				$v['phone'],
				$v['conv_count'],
				$v['req_count'],
				$v['input_tokens'],
				$v['output_tokens'],
				$v['total_tokens'],
				number_format( $v['cost'], 4 ),
			) );
		}

		fclose( $out );
		exit;
	}
}
