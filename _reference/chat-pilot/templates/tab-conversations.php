<?php
/**
 * Tab Conversations dashboard view template.
 */

// Prevent direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$conv_manager = new \ChatPilot\Conversations\ConversationManager();
$form_manager = new \ChatPilot\Forms\FormManager();

// Handle CSV Export
if ( isset( $_GET['export_csv'] ) && current_user_can( 'manage_options' ) ) {
	$conv_manager->export_csv( $_GET );
	exit;
}

// Parse Filter Arguments
$filter_args = array(
	'search'    => isset( $_GET['search'] ) ? sanitize_text_field( wp_unslash( $_GET['search'] ) ) : '',
	'status'    => isset( $_GET['status'] ) ? sanitize_key( wp_unslash( $_GET['status'] ) ) : 'all',
	'source'    => isset( $_GET['source'] ) ? sanitize_key( wp_unslash( $_GET['source'] ) ) : 'all',
	'form_id'   => isset( $_GET['form_id'] ) ? intval( $_GET['form_id'] ) : 0,
	'date_from' => isset( $_GET['date_from'] ) ? sanitize_text_field( wp_unslash( $_GET['date_from'] ) ) : '',
	'date_to'   => isset( $_GET['date_to'] ) ? sanitize_text_field( wp_unslash( $_GET['date_to'] ) ) : '',
);

$conversations = $conv_manager->get_conversations( $filter_args );
$forms         = $form_manager->get_forms();

// Calculate Summary Metrics
$total_count     = count( $conversations );
$active_count    = 0;
$completed_count = 0;
$unread_count    = 0;

foreach ( $conversations as $c ) {
	$st = isset( $c['status'] ) ? $c['status'] : 'active';
	if ( 'active' === $st ) {
		$active_count++;
	} elseif ( 'completed' === $st ) {
		$completed_count++;
	}
	if ( empty( $c['is_read'] ) ) {
		$unread_count++;
	}
}
?>

<!-- Conversations Header Banner -->
<div class="cp-card" style="margin-bottom:1.5rem; padding:1.5rem;">
	<div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:1rem;">
		<div>
			<h2 class="cp-card-title" style="margin:0; font-size:1.35rem; color:#ffffff !important;">
				💬 <?php esc_html_e( 'Conversations Manager', 'chat-pilot' ); ?>
			</h2>
			<p style="margin:0.25rem 0 0 0; font-size:0.85rem; color:var(--text-muted);">
				<?php esc_html_e( 'Central hub for monitoring, searching, filtering, and managing visitor and test AI chat transcripts.', 'chat-pilot' ); ?>
			</p>
		</div>

		<!-- Action Buttons -->
		<div style="display:flex; gap:0.75rem; align-items:center;">
			<a href="<?php echo esc_url( add_query_arg( array_merge( $_GET, array( 'export_csv' => '1' ) ) ) ); ?>" class="cp-btn cp-btn-secondary" style="margin:0; font-size:0.85rem;">
				📥 <?php esc_html_e( 'Export CSV', 'chat-pilot' ); ?>
			</a>
		</div>
	</div>

	<!-- Summary Metrics Strip -->
	<div style="display:grid; grid-template-columns: repeat(4, 1fr); gap:1rem; margin-top:1.25rem; border-top:1px solid rgba(255,255,255,0.05); padding-top:1.25rem;">
		<div style="background:rgba(15,23,42,0.6); border:1px solid rgba(255,255,255,0.06); padding:0.85rem 1rem; border-radius:8px;">
			<div style="font-size:0.75rem; color:var(--text-muted); font-weight:700; text-transform:uppercase;"><?php esc_html_e( 'Total Conversations', 'chat-pilot' ); ?></div>
			<div style="font-size:1.4rem; font-weight:800; color:#ffffff; margin-top:0.25rem;"><?php echo esc_html( $total_count ); ?></div>
		</div>
		<div style="background:rgba(15,23,42,0.6); border:1px solid rgba(34,197,94,0.2); padding:0.85rem 1rem; border-radius:8px;">
			<div style="font-size:0.75rem; color:var(--accent-green); font-weight:700; text-transform:uppercase;"><?php esc_html_e( 'Active Sessions', 'chat-pilot' ); ?></div>
			<div style="font-size:1.4rem; font-weight:800; color:#ffffff; margin-top:0.25rem;"><?php echo esc_html( $active_count ); ?></div>
		</div>
		<div style="background:rgba(15,23,42,0.6); border:1px solid rgba(6,182,212,0.2); padding:0.85rem 1rem; border-radius:8px;">
			<div style="font-size:0.75rem; color:var(--accent-cyan); font-weight:700; text-transform:uppercase;"><?php esc_html_e( 'Completed', 'chat-pilot' ); ?></div>
			<div style="font-size:1.4rem; font-weight:800; color:#ffffff; margin-top:0.25rem;"><?php echo esc_html( $completed_count ); ?></div>
		</div>
		<div style="background:rgba(15,23,42,0.6); border:1px solid rgba(245,158,11,0.2); padding:0.85rem 1rem; border-radius:8px;">
			<div style="font-size:0.75rem; color:var(--accent-orange); font-weight:700; text-transform:uppercase;"><?php esc_html_e( 'Unread Transcripts', 'chat-pilot' ); ?></div>
			<div style="font-size:1.4rem; font-weight:800; color:#ffffff; margin-top:0.25rem;"><?php echo esc_html( $unread_count ); ?></div>
		</div>
	</div>
</div>

<!-- Filters & Search Form -->
<div class="cp-card" style="margin-bottom:1.5rem; padding:1.25rem;">
	<form method="GET" style="display:grid; grid-template-columns: 2fr repeat(5, 1fr) 90px 80px; gap:0.6rem; align-items:end; margin:0;">
		<input type="hidden" name="page" value="chat-pilot">
		<input type="hidden" name="tab" value="conversations">

		<!-- Search Input -->
		<div class="cp-form-group" style="margin:0;">
			<label class="cp-label" style="font-size:0.75rem; color:#ffffff !important;"><?php esc_html_e( 'Search Conversations', 'chat-pilot' ); ?></label>
			<input type="text" name="search" class="cp-input" value="<?php echo esc_attr( $filter_args['search'] ); ?>" placeholder="<?php esc_attr_e( 'Name, Email, Phone, ID, or Message...', 'chat-pilot' ); ?>" style="height:38px;">
		</div>

		<!-- Status Filter -->
		<div class="cp-form-group" style="margin:0;">
			<label class="cp-label" style="font-size:0.75rem; color:#ffffff !important;"><?php esc_html_e( 'Status', 'chat-pilot' ); ?></label>
			<select name="status" class="cp-input" style="height:38px; min-height:38px; padding:0 0.5rem; line-height:36px; color:#ffffff !important; -webkit-text-fill-color:#ffffff !important; background-color:#1e293b !important; color-scheme:dark !important;">
				<option value="all" <?php selected( $filter_args['status'], 'all' ); ?>><?php esc_html_e( '— All Statuses —', 'chat-pilot' ); ?></option>
				<option value="active" <?php selected( $filter_args['status'], 'active' ); ?>><?php esc_html_e( '🟢 Active', 'chat-pilot' ); ?></option>
				<option value="completed" <?php selected( $filter_args['status'], 'completed' ); ?>><?php esc_html_e( '🔵 Completed', 'chat-pilot' ); ?></option>
			</select>
		</div>

		<!-- Source Filter -->
		<div class="cp-form-group" style="margin:0;">
			<label class="cp-label" style="font-size:0.75rem; color:#ffffff !important;"><?php esc_html_e( 'Source', 'chat-pilot' ); ?></label>
			<select name="source" class="cp-input" style="height:38px; min-height:38px; padding:0 0.5rem; line-height:36px; color:#ffffff !important; -webkit-text-fill-color:#ffffff !important; background-color:#1e293b !important; color-scheme:dark !important;">
				<option value="all" <?php selected( $filter_args['source'], 'all' ); ?>><?php esc_html_e( '— All Sources —', 'chat-pilot' ); ?></option>
				<option value="widget" <?php selected( $filter_args['source'], 'widget' ); ?>><?php esc_html_e( '🌐 Frontend Widget', 'chat-pilot' ); ?></option>
				<option value="playground" <?php selected( $filter_args['source'], 'playground' ); ?>><?php esc_html_e( '🛠️ Developer Preview', 'chat-pilot' ); ?></option>
			</select>
		</div>

		<!-- Form Filter -->
		<div class="cp-form-group" style="margin:0;">
			<label class="cp-label" style="font-size:0.75rem; color:#ffffff !important;"><?php esc_html_e( 'Form Used', 'chat-pilot' ); ?></label>
			<select name="form_id" class="cp-input" style="height:38px; min-height:38px; padding:0 0.5rem; line-height:36px; color:#ffffff !important; -webkit-text-fill-color:#ffffff !important; background-color:#1e293b !important; color-scheme:dark !important;">
				<option value="0" <?php selected( $filter_args['form_id'], 0 ); ?>><?php esc_html_e( '— All Forms —', 'chat-pilot' ); ?></option>
				<?php foreach ( $forms as $f ) : ?>
					<option value="<?php echo esc_attr( $f['id'] ); ?>" <?php selected( $filter_args['form_id'], $f['id'] ); ?>>
						<?php echo esc_html( $f['name'] ); ?>
					</option>
				<?php endforeach; ?>
			</select>
		</div>

		<!-- Date From -->
		<div class="cp-form-group" style="margin:0;">
			<label class="cp-label" style="font-size:0.75rem; color:#ffffff !important;"><?php esc_html_e( 'Date From', 'chat-pilot' ); ?></label>
			<input type="date" name="date_from" class="cp-input" value="<?php echo esc_attr( $filter_args['date_from'] ); ?>" style="height:38px; padding:0 0.4rem;">
		</div>

		<!-- Date To -->
		<div class="cp-form-group" style="margin:0;">
			<label class="cp-label" style="font-size:0.75rem; color:#ffffff !important;"><?php esc_html_e( 'Date To', 'chat-pilot' ); ?></label>
			<input type="date" name="date_to" class="cp-input" value="<?php echo esc_attr( $filter_args['date_to'] ); ?>" style="height:38px; padding:0 0.4rem;">
		</div>

		<!-- Submit & Reset Buttons -->
		<div style="display:flex; gap:0.4rem;">
			<button type="submit" class="cp-btn cp-btn-primary" style="margin:0; width:100%; padding:0.55rem 0.4rem; font-size:0.8rem;">
				🔍 <?php esc_html_e( 'Filter', 'chat-pilot' ); ?>
			</button>
		</div>
		<div>
			<a href="?page=chat-pilot&tab=conversations" class="cp-btn cp-btn-secondary" style="margin:0; display:block; text-align:center; padding:0.55rem 0.4rem; font-size:0.8rem;">
				↺ <?php esc_html_e( 'Reset', 'chat-pilot' ); ?>
			</a>
		</div>
	</form>
</div>

<!-- Conversations Table -->
<div class="cp-card" style="padding:1.5rem;">
	<div style="overflow-x:auto;">
		<table class="cp-table">
			<thead>
				<tr>
					<th style="width:80px;"><?php esc_html_e( 'ID / Status', 'chat-pilot' ); ?></th>
					<th><?php esc_html_e( 'Visitor Details', 'chat-pilot' ); ?></th>
					<th><?php esc_html_e( 'Contact Info', 'chat-pilot' ); ?></th>
					<th><?php esc_html_e( 'Source & Form', 'chat-pilot' ); ?></th>
					<th><?php esc_html_e( 'Timestamps', 'chat-pilot' ); ?></th>
					<th style="text-align:center;"><?php esc_html_e( 'Messages', 'chat-pilot' ); ?></th>
					<th style="text-align:right;"><?php esc_html_e( 'Actions', 'chat-pilot' ); ?></th>
				</tr>
			</thead>
			<tbody>
				<?php if ( empty( $conversations ) ) : ?>
					<tr>
						<td colspan="7" style="text-align:center; padding:3.5rem 1rem; color:var(--text-muted);">
							<div style="font-size:2.5rem; margin-bottom:0.5rem;">💬</div>
							<div style="font-size:1.1rem; font-weight:700; color:#ffffff;"><?php esc_html_e( 'No Conversations Found', 'chat-pilot' ); ?></div>
							<p style="margin:0.5rem 0 0 0; font-size:0.85rem; font-style:italic;">
								<?php esc_html_e( 'No chat transcripts matched your search or filter parameters.', 'chat-pilot' ); ?>
							</p>
						</td>
					</tr>
				<?php else : ?>
					<?php foreach ( $conversations as $row ) : ?>
						<?php
						$conv_id = (int) $row['id'];
						$status  = ! empty( $row['status'] ) ? $row['status'] : 'active';
						$source  = ! empty( $row['source'] ) ? $row['source'] : 'widget';
						$is_unread = empty( $row['is_read'] );
						$msgs    = is_array( $row['messages'] ) ? $row['messages'] : array();
						$count   = count( $msgs );

						$name  = ! empty( $row['visitor_name'] ) ? $row['visitor_name'] : esc_html__( 'Anonymous Visitor', 'chat-pilot' );
						$email = ! empty( $row['visitor_email'] ) ? $row['visitor_email'] : '—';
						$phone = ! empty( $row['visitor_phone'] ) ? $row['visitor_phone'] : '—';

						// Form name resolution
						$form_title = 'Standard Form';
						if ( ! empty( $row['form_id'] ) ) {
							$f = $form_manager->get_form( $row['form_id'] );
							if ( $f ) {
								$form_title = $f['name'];
							}
						}

						// Status Badge Styling
						$status_bg = 'rgba(34,197,94,0.15)';
						$status_fg = 'var(--accent-green)';
						$status_text = 'ACTIVE';
						if ( 'completed' === $status ) {
							$status_bg = 'rgba(6,182,212,0.15)';
							$status_fg = 'var(--accent-cyan)';
							$status_text = 'COMPLETED';
						} elseif ( 'archived' === $status ) {
							$status_bg = 'rgba(148,163,184,0.15)';
							$status_fg = '#94a3b8';
							$status_text = 'ARCHIVED';
						}

						// Source Badge Styling
						$source_bg = 'rgba(59,130,246,0.15)';
						$source_fg = '#60a5fa';
						$source_text = '🌐 WIDGET';
						if ( 'playground' === $source ) {
							$source_bg = 'rgba(168,85,247,0.15)';
							$source_fg = 'var(--accent-purple)';
							$source_text = '🛠️ PREVIEW';
						}
						?>
						<tr class="cp-conv-row <?php echo $is_unread ? 'unread-row' : ''; ?>" id="cp-conv-row-<?php echo esc_attr( $conv_id ); ?>" style="<?php echo $is_unread ? 'background:rgba(6,182,212,0.03);' : ''; ?>">
							<td>
								<div style="display:flex; align-items:center; gap:0.4rem;">
									<?php if ( $is_unread ) : ?>
										<span title="Unread conversation" style="width:8px; height:8px; background:#06b6d4; border-radius:50%; display:inline-block; filter:drop-shadow(0 0 4px #06b6d4);"></span>
									<?php endif; ?>
									<strong style="color:#ffffff; font-family:monospace;">#<?php echo esc_html( $conv_id ); ?></strong>
								</div>
								<div style="margin-top:0.35rem;">
									<span style="font-size:0.65rem; font-weight:800; padding:0.15rem 0.4rem; border-radius:4px; background:<?php echo $status_bg; ?>; color:<?php echo $status_fg; ?>;">
										<?php echo esc_html( $status_text ); ?>
									</span>
								</div>
							</td>
							<td>
								<strong style="color:#ffffff; font-size:0.9rem;"><?php echo esc_html( $name ); ?></strong>
								<div style="font-size:0.75rem; color:var(--text-muted); font-family:monospace; margin-top:0.1rem;">
									<?php echo esc_html( $row['session_id'] ); ?>
								</div>
								<div style="margin-top:0.35rem;">
									<button type="button" class="cp-btn cp-btn-sm cp-js-open-conv" data-id="<?php echo esc_attr( $conv_id ); ?>" style="margin:0; font-size:0.72rem; padding:0.2rem 0.55rem; background:rgba(6,182,212,0.12); color:var(--accent-cyan); border:1px solid rgba(6,182,212,0.3); border-radius:4px; cursor:pointer; display:inline-flex; align-items:center; gap:0.3rem;" title="Click to view conversation summary & details popup">
										📝 Summary
									</button>
								</div>
							</td>
							<td>
								<div style="font-size:0.85rem; color:#e2e8f0;">📧 <?php echo esc_html( $email ); ?></div>
								<div style="font-size:0.85rem; color:var(--text-muted); margin-top:0.2rem;">📞 <?php echo esc_html( $phone ); ?></div>
							</td>
							<td>
								<div>
									<span style="font-size:0.68rem; font-weight:700; padding:0.15rem 0.4rem; border-radius:4px; background:<?php echo $source_bg; ?>; color:<?php echo $source_fg; ?>;">
										<?php echo esc_html( $source_text ); ?>
									</span>
								</div>
								<div style="font-size:0.75rem; color:var(--text-muted); margin-top:0.35rem; overflow:hidden; text-overflow:ellipsis; max-width:140px; white-space:nowrap;">
									📋 <?php echo esc_html( $form_title ); ?>
								</div>
							</td>
							<td>
								<div style="font-size:0.8rem; color:#ffffff; font-weight:600;"><?php echo esc_html( date( 'M j, Y g:i A', strtotime( $row['updated_at'] ) ) ); ?></div>
								<div style="font-size:0.72rem; color:var(--text-muted); margin-top:0.15rem;">Started: <?php echo esc_html( date( 'M j, g:i A', strtotime( $row['created_at'] ) ) ); ?></div>
							</td>
							<td style="text-align:center;">
								<span style="background:rgba(6,182,212,0.1); border:1px solid rgba(6,182,212,0.25); color:var(--accent-cyan); font-weight:700; padding:0.25rem 0.6rem; border-radius:20px; font-size:0.75rem;">
									<?php echo esc_html( $count ); ?> msgs
								</span>
							</td>
							<td style="text-align:right;">
								<div style="display:flex; justify-content:flex-end; gap:0.4rem;" class="cp-conv-actions">
									<button type="button" class="cp-btn cp-btn-sm cp-btn-primary cp-js-open-conv" data-id="<?php echo esc_attr( $conv_id ); ?>" title="View Summary & Details">
										👁️ <?php esc_html_e( 'View', 'chat-pilot' ); ?>
									</button>
									<button type="button" class="cp-btn cp-btn-sm cp-js-delete-conv" data-id="<?php echo esc_attr( $conv_id ); ?>" style="background:rgba(239,68,68,0.1); color:#ef4444; border:1px solid rgba(239,68,68,0.2);" title="Delete Conversation">
										🗑️
									</button>
								</div>
							</td>
						</tr>
					<?php endforeach; ?>
				<?php endif; ?>
			</tbody>
		</table>
	</div>
</div>

<!-- Detailed Conversation Modal (Glassmorphic Overlay) -->
<div id="cp-conv-details-overlay" style="display:none; position:fixed; inset:0; background:rgba(0,0,0,0.75); backdrop-filter:blur(10px); -webkit-backdrop-filter:blur(10px); z-index:99999; justify-content:center; align-items:center; padding:2rem;">
	<div class="cp-card" style="width:100%; max-width:850px; height:85vh; display:flex; flex-direction:column; margin:0; border:1px solid rgba(6,182,212,0.3); overflow:hidden; padding:0; box-shadow: 0 20px 50px rgba(0,0,0,0.8);">
		
		<!-- Modal Header -->
		<div style="display:flex; justify-content:space-between; align-items:center; padding:1.25rem 1.5rem; background:rgba(15,23,42,0.9); border-bottom:1px solid rgba(255,255,255,0.08);">
			<div style="display:flex; align-items:center; gap:0.75rem;">
				<span style="font-size:1.25rem;">💬</span>
				<div>
					<h3 style="font-family:'Outfit', sans-serif; font-size:1.15rem; margin:0; color:#ffffff;" id="cp-modal-conv-title">
						<?php esc_html_e( 'Loading Conversation...', 'chat-pilot' ); ?>
					</h3>
					<div style="font-size:0.75rem; color:var(--text-muted); font-family:monospace; margin-top:0.15rem;" id="cp-modal-session-id"></div>
				</div>
			</div>

			<!-- Status controls and close -->
			<div style="display:flex; align-items:center; gap:0.75rem;">
				<select id="cp-modal-status-select" class="cp-input" style="height:32px; font-size:0.75rem; padding:0 0.5rem; color:#ffffff !important; -webkit-text-fill-color:#ffffff !important; background-color:#1e293b !important; color-scheme:dark !important;">
					<option value="active">🟢 Active</option>
					<option value="completed">🔵 Completed</option>
				</select>
				<button type="button" id="cp-close-conv-modal" style="background:none; border:none; color:#94a3b8; font-size:1.5rem; cursor:pointer; padding:0; line-height:1;" title="Close Modal">✕</button>
			</div>
		</div>

		<!-- Modal Body Split: Sidebar Details + Message Stream -->
		<div style="display:grid; grid-template-columns: 260px 1fr; flex-grow:1; overflow:hidden;">
			
			<!-- Left Metadata Panel -->
			<div style="background:rgba(15,23,42,0.7); border-right:1px solid rgba(255,255,255,0.06); padding:1.25rem; display:flex; flex-direction:column; gap:1rem; overflow-y:auto;">
				<div>
					<div style="font-size:0.7rem; color:var(--text-muted); font-weight:700; text-transform:uppercase; margin-bottom:0.35rem;"><?php esc_html_e( 'Visitor Credentials', 'chat-pilot' ); ?></div>
					<div style="font-weight:700; font-size:0.95rem; color:#ffffff;" id="cp-modal-vname"></div>
					<div style="font-size:0.8rem; color:#cbd5e1; margin-top:0.25rem;" id="cp-modal-vemail"></div>
					<div style="font-size:0.8rem; color:var(--text-muted); margin-top:0.15rem;" id="cp-modal-vphone"></div>
				</div>

				<div style="border-top:1px solid rgba(255,255,255,0.05); padding-top:0.75rem;">
					<div style="font-size:0.7rem; color:var(--text-muted); font-weight:700; text-transform:uppercase; margin-bottom:0.35rem;"><?php esc_html_e( 'Form & Source', 'chat-pilot' ); ?></div>
					<div style="font-size:0.85rem; color:#ffffff;" id="cp-modal-form-used"></div>
					<div style="margin-top:0.35rem;" id="cp-modal-source-badge"></div>
				</div>

				<div style="border-top:1px solid rgba(255,255,255,0.05); padding-top:0.75rem;">
					<div style="font-size:0.7rem; color:var(--text-muted); font-weight:700; text-transform:uppercase; margin-bottom:0.35rem;"><?php esc_html_e( 'Session Metrics', 'chat-pilot' ); ?></div>
					<div style="font-size:0.75rem; color:var(--text-muted);"><?php esc_html_e( 'Started:', 'chat-pilot' ); ?> <span id="cp-modal-started" style="color:#ffffff;"></span></div>
					<div style="font-size:0.75rem; color:var(--text-muted); margin-top:0.25rem;"><?php esc_html_e( 'Last Activity:', 'chat-pilot' ); ?> <span id="cp-modal-activity" style="color:#ffffff;"></span></div>
					<div style="font-size:0.75rem; color:var(--text-muted); margin-top:0.25rem;"><?php esc_html_e( 'Total Messages:', 'chat-pilot' ); ?> <span id="cp-modal-msg-count" style="color:var(--accent-cyan); font-weight:700;"></span></div>
				</div>

				<!-- AI Engine Execution Metadata Diagnostics -->
				<div style="border-top:1px solid rgba(255,255,255,0.05); padding-top:0.75rem; margin-top:auto;">
					<button type="button" id="cp-toggle-diagnostics-btn" class="cp-btn cp-btn-sm cp-btn-secondary" style="width:100%; margin:0; font-size:0.72rem; padding:0.35rem;">
						🔍 AI Engine Diagnostics
					</button>
					<div id="cp-modal-diagnostics-body" style="display:none; margin-top:0.75rem; background:rgba(0,0,0,0.4); border:1px solid rgba(255,255,255,0.08); padding:0.6rem; border-radius:6px; font-size:0.72rem; font-family:monospace; color:#cbd5e1; flex-direction:column; gap:0.35rem;">
						<!-- Diagnostics output -->
					</div>
				</div>
			</div>

			<!-- Right Chronological Message Stream -->
			<div style="display:flex; flex-direction:column; background:rgba(15,23,42,0.95); overflow:hidden;">
				<div id="cp-modal-messages-stream" style="flex-grow:1; overflow-y:auto; padding:1.5rem; display:flex; flex-direction:column; gap:1rem;">
					<!-- Message bubbles populate here -->
				</div>
			</div>
		</div>
	</div>
</div>

<!-- Script Binds for Conversations Module -->
<script type="text/javascript">
jQuery(document).ready(function($) {
	var activeConvId = 0;

	// 1. Open Detail Modal via AJAX
	$(document).on('click', '.cp-js-open-conv', function() {
		var convId = $(this).data('id');
		openConversationModal(convId);
	});

	function openConversationModal(convId) {
		activeConvId = convId;
		$('#cp-modal-messages-stream').html('<div style="text-align:center; padding:3rem; color:var(--text-muted); font-style:italic;">Loading conversation details...</div>');
		$('#cp-conv-details-overlay').css('display', 'flex');

		$.ajax({
			url: chatPilotAdmin.ajaxUrl,
			type: 'POST',
			data: {
				action: 'chat_pilot_get_conversation_detail',
				id: convId,
				_wpnonce: chatPilotAdmin.securityNonce
			},
			dataType: 'json',
			success: function(response) {
				if (response.success) {
					var c = response.data.conversation;
					renderModalDetails(c);
				} else {
					$('#cp-modal-messages-stream').html('<div style="text-align:center; padding:3rem; color:#ef4444;">' + response.data.message + '</div>');
				}
			},
			error: function() {
				$('#cp-modal-messages-stream').html('<div style="text-align:center; padding:3rem; color:#ef4444;">System error fetching conversation details.</div>');
			}
		});
	}

	function renderModalDetails(c) {
		var name = c.visitor_name ? c.visitor_name : 'Anonymous Visitor';
		$('#cp-modal-conv-title').text(name + ' (#' + c.id + ')');
		$('#cp-modal-session-id').text('Session: ' + c.session_id);
		$('#cp-modal-vname').text(name);
		$('#cp-modal-vemail').text(c.visitor_email ? '📧 ' + c.visitor_email : '📧 Not provided');
		$('#cp-modal-vphone').text(c.visitor_phone ? '📞 ' + c.visitor_phone : '📞 Not provided');
		$('#cp-modal-form-used').text(c.form_name ? c.form_name : 'Standard Form');
		$('#cp-modal-status-select').val(c.status || 'active');

		var srcBadge = (c.source === 'playground') ? 
			'<span style="font-size:0.68rem; font-weight:700; padding:0.15rem 0.4rem; border-radius:4px; background:rgba(168,85,247,0.15); color:var(--accent-purple);">🛠️ Developer Preview</span>' :
			'<span style="font-size:0.68rem; font-weight:700; padding:0.15rem 0.4rem; border-radius:4px; background:rgba(59,130,246,0.15); color:#60a5fa;">🌐 Frontend Widget</span>';
		$('#cp-modal-source-badge').html(srcBadge);

		$('#cp-modal-started').text(c.created_at || '—');
		$('#cp-modal-activity').text(c.updated_at || '—');

		var msgs = c.messages || [];
		$('#cp-modal-msg-count').text(msgs.length + ' messages');

		// Diagnostics payload
		var meta = c.metadata || {};
		var diagHtml = '<div><strong>Provider:</strong> ' + (meta.provider || 'Local / Gemini API') + '</div>' +
			'<div><strong>Model:</strong> ' + (meta.model || 'gemini-1.5-pro') + '</div>' +
			'<div><strong>Latency:</strong> ' + (meta.latency_ms ? meta.latency_ms + ' ms' : 'N/A') + '</div>' +
			'<div><strong>Docs Used:</strong> ' + (meta.docs_count ? meta.docs_count + ' chunks' : '0') + '</div>';
		$('#cp-modal-diagnostics-body').html(diagHtml);

		// Render Messages Stream with prominent Conversation Summary card
		var $stream = $('#cp-modal-messages-stream').empty();

		var summaryText = c.summary || 'Conversation initiated.';
		var summaryCard = '<div style="background:rgba(6,182,212,0.06); border:1px solid rgba(6,182,212,0.25); padding:1rem 1.25rem; border-radius:10px; margin-bottom:1rem;">' +
			'<div style="font-size:0.75rem; font-weight:800; color:var(--accent-cyan); text-transform:uppercase; letter-spacing:0.05em; display:flex; align-items:center; gap:0.4rem;">' +
				'📝 Conversation Summary' +
			'</div>' +
			'<div style="font-size:0.9rem; color:#ffffff; font-weight:600; margin-top:0.4rem; line-height:1.4;">' +
				escapeHtml(summaryText) +
			'</div>' +
		'</div>' +
		'<div style="font-size:0.75rem; font-weight:800; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.05em; margin-bottom:0.75rem; border-bottom:1px solid rgba(255,255,255,0.06); padding-bottom:0.4rem;">' +
			'💬 Full Conversation' +
		'</div>';

		$stream.append(summaryCard);

		if (!msgs.length) {
			$stream.append('<div style="text-align:center; padding:2rem; color:var(--text-muted); font-style:italic;">No messages recorded in this conversation.</div>');
			return;
		}

		$.each(msgs, function(i, m) {
			var isUser = (m.role === 'user');
			var senderLabel = isUser ? 'Visitor' : 'Chat Pilot AI';
			var alignSelf = isUser ? 'align-self: flex-end;' : 'align-self: flex-start;';
			var bg = isUser ? 'var(--accent-cyan)' : 'rgba(30,41,59,0.85)';
			var border = isUser ? 'none' : '1px solid rgba(255,255,255,0.06)';
			var color = isUser ? '#ffffff' : '#e2e8f0';
			var borderRadius = isUser ? '14px 14px 2px 14px' : '14px 14px 14px 2px';

			var msgHtml = '<div style="' + alignSelf + ' max-width:82%; display:flex; flex-direction:column; gap:0.25rem;">' +
				'<div style="font-size:0.7rem; color:var(--text-muted); font-weight:700; text-align:' + (isUser ? 'right' : 'left') + ';">' +
					senderLabel + ' • ' + (m.time || '') +
				'</div>' +
				'<div style="background:' + bg + '; border:' + border + '; color:' + color + '; padding:0.75rem 1rem; border-radius:' + borderRadius + '; font-size:0.9rem; line-height:1.5; white-space:pre-wrap; word-break:break-word;">' +
					escapeHtml(m.content) +
				'</div>' +
			'</div>';

			$stream.append(msgHtml);
		});

		$stream.scrollTop($stream[0].scrollHeight);
		
		// Remove unread highlight from row in table
		$('#cp-conv-row-' + c.id).removeClass('unread-row').css('background', 'transparent').find('span[title="Unread conversation"]').remove();
	}

	// 2. Status Change from Select Inside Modal
	$('#cp-modal-status-select').on('change', function() {
		var newStatus = $(this).val();
		if (!activeConvId) return;

		$.ajax({
			url: chatPilotAdmin.ajaxUrl,
			type: 'POST',
			data: {
				action: 'chat_pilot_update_conversation_status',
				id: activeConvId,
				status: newStatus,
				_wpnonce: chatPilotAdmin.securityNonce
			},
			dataType: 'json',
			success: function(response) {
				if (response.success) {
					showNotification(response.data.message, 'success');
					setTimeout(function() { window.location.reload(); }, 600);
				} else {
					alert(response.data.message || 'Status update failed.');
				}
			}
		});
	});

	// 3. Status Change directly from Table Row Action
	$('.cp-js-status-conv').on('click', function() {
		var convId = $(this).data('id');
		var newStatus = $(this).data('status');

		$.ajax({
			url: chatPilotAdmin.ajaxUrl,
			type: 'POST',
			data: {
				action: 'chat_pilot_update_conversation_status',
				id: convId,
				status: newStatus,
				_wpnonce: chatPilotAdmin.securityNonce
			},
			dataType: 'json',
			success: function(response) {
				if (response.success) {
					showNotification(response.data.message, 'success');
					setTimeout(function() { window.location.reload(); }, 600);
				} else {
					alert(response.data.message || 'Status update failed.');
				}
			}
		});
	});

	// 4. Delete Conversation
	$('.cp-js-delete-conv').on('click', function() {
		var convId = $(this).data('id');
		if (!confirm('Are you sure you want to permanently delete Conversation #' + convId + '? This action cannot be undone.')) {
			return;
		}

		$.ajax({
			url: chatPilotAdmin.ajaxUrl,
			type: 'POST',
			data: {
				action: 'chat_pilot_delete_conversation',
				id: convId,
				_wpnonce: chatPilotAdmin.securityNonce
			},
			dataType: 'json',
			success: function(response) {
				if (response.success) {
					showNotification(response.data.message, 'success');
					$('#cp-conv-row-' + convId).fadeOut(300, function() { $(this).remove(); });
					if (activeConvId === convId) {
						$('#cp-conv-details-overlay').hide();
					}
				} else {
					alert(response.data.message || 'Delete operation failed.');
				}
			}
		});
	});

	// 5. Toggle Diagnostics inside modal
	$('#cp-toggle-diagnostics-btn').on('click', function() {
		$('#cp-modal-diagnostics-body').slideToggle(200);
	});

	// 6. Close Modal Listeners
	$('#cp-close-conv-modal, #cp-conv-details-overlay').on('click', function(e) {
		if (e.target === this) {
			$('#cp-conv-details-overlay').hide();
		}
	});

	// Auto open modal if URL contains conv_id parameter
	var urlParams = new URLSearchParams(window.location.search);
	var targetConvId = urlParams.get('conv_id');
	if (targetConvId) {
		openConversationModal(targetConvId);
	}

	function escapeHtml(text) {
		if (!text) return '';
		return text
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;")
			.replace(/'/g, "&#039;");
	}
});
</script>
