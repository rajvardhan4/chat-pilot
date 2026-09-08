<?php
/**
 * Tab Forms & Submissions Redesigned View Template
 */

// Prevent direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$form_manager = new \ChatPilot\Forms\FormManager();
$forms        = $form_manager->get_forms();

// Filter submissions
$sub_args = array();
if ( ! empty( $_GET['filter_form_id'] ) ) {
	$sub_args['form_id'] = intval( $_GET['filter_form_id'] );
}
if ( ! empty( $_GET['sub_search'] ) ) {
	$sub_args['search'] = sanitize_text_field( $_GET['sub_search'] );
}
if ( ! empty( $_GET['date_from'] ) ) {
	$sub_args['date_from'] = sanitize_text_field( $_GET['date_from'] );
}
if ( ! empty( $_GET['date_to'] ) ) {
	$sub_args['date_to'] = sanitize_text_field( $_GET['date_to'] );
}

$submissions = $form_manager->get_submissions( $sub_args );
$active_sub_tab = isset( $_GET['sub_tab'] ) ? sanitize_key( $_GET['sub_tab'] ) : 'builder';
?>

<div class="cp-forms-dashboard-wrapper">
	<!-- 1. Hero Header Section -->
	<section class="cp-kb-hero" style="margin-bottom: 1.5rem;">
		<div class="cp-kb-hero-content">
			<h2><?php esc_html_e( 'Forms & Lead Ingestion', 'chat-pilot' ); ?></h2>
			<p><?php esc_html_e( 'Design custom pre-chat forms, collect visitor details, validate input criteria, and track conversation leads.', 'chat-pilot' ); ?></p>
		</div>
	</section>

	<!-- Sub-tab Navigation -->
	<div style="display:flex; gap:1rem; border-bottom:1px solid rgba(255,255,255,0.06); padding-bottom:1rem; margin-bottom:1.5rem;">
		<a href="?page=chat-pilot&tab=forms&sub_tab=builder" class="cp-btn <?php echo $active_sub_tab === 'builder' ? 'cp-btn-primary' : 'cp-btn-secondary'; ?>" style="margin:0; font-size:0.9rem;">
			📋 <?php esc_html_e( 'Form Builder', 'chat-pilot' ); ?>
		</a>
		<a href="?page=chat-pilot&tab=forms&sub_tab=submissions" class="cp-btn <?php echo $active_sub_tab === 'submissions' ? 'cp-btn-primary' : 'cp-btn-secondary'; ?>" style="margin:0; font-size:0.9rem;">
			📥 <?php esc_html_e( 'Form Submissions', 'chat-pilot' ); ?>
		</a>
	</div>

	<?php if ( 'builder' === $active_sub_tab ) : ?>
		<!-- ================= FORM BUILDER VIEW ================= -->
		<div style="display:grid; grid-template-columns:320px 1fr; gap:1.5rem; align-items:start;">
			<!-- Left side: List of forms -->
			<div style="display:flex; flex-direction:column; gap:1rem;">
				<div class="cp-card" style="padding:1.25rem;">
					<h3 class="cp-card-title" style="margin-bottom:1rem; font-size:1.05rem; display:flex; justify-content:space-between; align-items:center; color:#ffffff !important;">
						<span style="color:#ffffff !important; font-weight:700;">📂 <?php esc_html_e( 'Saved Forms', 'chat-pilot' ); ?></span>
						<button type="button" id="cp-create-new-form-btn" class="cp-btn cp-btn-sm cp-btn-primary" style="margin:0; font-size:0.75rem; padding:0.25rem 0.5rem;">+ New</button>
					</h3>
					
					<div id="cp-forms-list-container" style="display:flex; flex-direction:column; gap:0.5rem; max-height:450px; overflow-y:auto; padding-right:5px;">
						<?php foreach ( $forms as $f ) : ?>
							<div class="cp-form-item-card <?php echo $f['is_default'] ? 'default-form' : ''; ?>" data-form-id="<?php echo esc_attr( $f['id'] ); ?>" style="background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.06); padding:0.75rem; border-radius:8px; display:flex; flex-direction:column; gap:0.5rem; transition:all 0.2s ease; cursor:pointer;">
								<div style="display:flex; justify-content:space-between; align-items:center;">
									<span style="font-weight:700; font-size:0.9rem; color:#ffffff; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:180px;">
										<?php echo esc_html( $f['name'] ); ?>
									</span>
									<span class="cp-badge-default-container">
										<?php if ( $f['is_default'] ) : ?>
											<span class="cp-badge-default-tag" style="font-size:0.7rem; background:rgba(34,197,94,0.15); color:var(--accent-green); padding:0.15rem 0.35rem; border-radius:4px; font-weight:700;"><?php esc_html_e( 'Default', 'chat-pilot' ); ?></span>
										<?php endif; ?>
									</span>
								</div>
								
								<div style="display:flex; justify-content:space-between; align-items:center; font-size:0.75rem; color:var(--text-muted);">
									<span><?php echo sprintf( esc_html__( '%d fields', 'chat-pilot' ), count( $f['fields'] ) ); ?></span>
									<div style="display:flex; gap:0.4rem;" class="cp-form-item-actions">
										<button type="button" class="cp-form-act-btn cp-form-act-edit" style="background:none; border:none; color:var(--accent-cyan); cursor:pointer;" title="Edit Form">✏️</button>
										<button type="button" class="cp-form-act-btn cp-form-act-duplicate" style="background:none; border:none; color:var(--accent-purple); cursor:pointer;" title="Duplicate Form">📋</button>
										<button type="button" class="cp-form-act-btn cp-form-act-default" style="background:none; border:none; color:var(--accent-green); cursor:pointer; <?php echo $f['is_default'] ? 'display:none;' : ''; ?>" title="Set as Default">⭐</button>
										<button type="button" class="cp-form-act-btn cp-form-act-delete" style="background:none; border:none; color:#ef4444; cursor:pointer; <?php echo $f['is_default'] ? 'display:none;' : ''; ?>" title="Delete Form">🗑️</button>
									</div>
								</div>
							</div>
						<?php endforeach; ?>
					</div>
				</div>
			</div>

			<!-- Right side: Builder and Interactive Preview wrapper -->
			<div style="display:grid; grid-template-columns: 1fr 340px; gap:1.5rem; align-items:start;" id="cp-builder-main-wrapper">
				<!-- Form Fields Designer -->
				<div class="cp-card" style="padding:1.5rem; min-height:550px;">
					<h3 class="cp-card-title" style="margin-bottom:1.5rem; border-bottom:1px solid rgba(255,255,255,0.06); padding-bottom:0.75rem; color:var(--accent-cyan); display:flex; justify-content:space-between; align-items:center;">
						<span id="cp-builder-form-title"><?php esc_html_e( 'Form Fields Designer', 'chat-pilot' ); ?></span>
						<span style="font-size:0.75rem; color:var(--text-muted); font-weight:normal;" id="cp-builder-form-status-indicator"></span>
					</h3>
					
					<form id="cp-form-builder-editor" style="display:flex; flex-direction:column; gap:1.25rem;">
						<input type="hidden" id="cp-builder-form-id" value="0">
						
						<!-- Form Name & Default Checkbox -->
						<div style="display:grid; grid-template-columns: 1fr 180px; gap:1rem; align-items:end;">
							<div class="cp-form-group" style="margin:0;">
								<label class="cp-label" for="cp-form-name-input"><?php esc_html_e( 'Form Title Name', 'chat-pilot' ); ?></label>
								<input type="text" id="cp-form-name-input" class="cp-input" value="" placeholder="Enter form name..." required>
							</div>
							<div class="cp-form-group" style="margin:0; padding-bottom:0.4rem;">
								<label class="cp-checkbox-label" style="font-size:0.82rem; cursor:pointer;">
									<input type="checkbox" id="cp-builder-form-is-default" class="cp-checkbox" value="1">
									<span style="color:#ffffff; font-weight:600;"><?php esc_html_e( 'Set as Active Default', 'chat-pilot' ); ?></span>
								</label>
							</div>
						</div>

						<!-- Field Rows Container -->
						<div>
							<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.75rem;">
								<label class="cp-label" style="margin:0;"><?php esc_html_e( 'Fields Structure Configuration', 'chat-pilot' ); ?></label>
								<button type="button" id="cp-builder-add-field-btn" class="cp-btn cp-btn-sm cp-btn-secondary" style="margin:0; font-size:0.8rem;">➕ Add Custom Field</button>
							</div>
							
							<div id="cp-builder-fields-list" style="display:flex; flex-direction:column; gap:0.75rem; background:rgba(0,0,0,0.15); border:1px solid rgba(255,255,255,0.04); border-radius:8px; padding:1rem; min-height:100px;">
								<!-- Field templates injected dynamically via script -->
							</div>
						</div>

						<div style="margin-top:1.5rem; border-top:1px solid rgba(255,255,255,0.05); padding-top:1.25rem;">
							<button type="submit" class="cp-btn cp-btn-primary" style="margin:0;"><?php esc_html_e( 'Save Form Configuration', 'chat-pilot' ); ?></button>
						</div>
					</form>
				</div>

				<!-- Live Interactive Preview Panel -->
				<div class="cp-card" style="padding:1.25rem; display:flex; flex-direction:column; gap:1rem;">
					<h3 class="cp-card-title" style="margin-bottom:0; font-size:1rem; color:var(--accent-purple); display:flex; justify-content:space-between; align-items:center;">
						<span>👁️ <?php esc_html_e( 'Live Preview', 'chat-pilot' ); ?></span>
						
						<!-- Desktop/Mobile device toggle icons -->
						<div style="display:flex; gap:0.25rem;">
							<button type="button" class="cp-preview-device-toggle cp-preview-dev-active" data-device="desktop" style="background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); border-radius:4px; padding:0.25rem 0.4rem; color:#ffffff; font-size:0.75rem; cursor:pointer;" title="Desktop Preview">🖥️</button>
							<button type="button" class="cp-preview-device-toggle" data-device="mobile" style="background:none; border:1px solid rgba(255,255,255,0.06); border-radius:4px; padding:0.25rem 0.4rem; color:var(--text-muted); font-size:0.75rem; cursor:pointer;" title="Mobile Preview">📱</button>
						</div>
					</h3>

					<!-- Simulator Frame -->
					<div id="cp-preview-device-frame" class="cp-preview-frame-desktop" style="background:rgba(15,23,42,0.9); border:1px solid rgba(255,255,255,0.08); border-radius:12px; transition:all 0.3s cubic-bezier(0.4, 0, 0.2, 1); width:100%; min-height:450px; display:flex; flex-direction:column; overflow:hidden;">
						<!-- Header -->
						<div style="background:rgba(30,41,59,0.9); padding:0.75rem 1rem; display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid rgba(255,255,255,0.06);">
							<div style="display:flex; align-items:center; gap:0.5rem;">
								<div style="width:24px; height:24px; border-radius:50%; background:rgba(6,182,212,0.1); border:1px solid rgba(6,182,212,0.3); display:flex; align-items:center; justify-content:center; font-size:0.75rem;">🤖</div>
								<div style="display:flex; flex-direction:column; gap:1px;">
									<span style="font-weight:700; font-size:0.75rem; color:#ffffff; line-height:1;">Assistant Simulator</span>
									<span style="font-size:0.6rem; color:var(--accent-cyan);" id="cp-preview-header-subtitle">Pre-chat Form</span>
								</div>
							</div>
							<button type="button" id="cp-preview-reset-btn" style="background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); border-radius:4px; padding:0.2rem 0.4rem; color:var(--text-muted); font-size:0.65rem; cursor:pointer;" title="Reset Simulator">🔄 Reset</button>
						</div>

						<!-- Pre-Chat Form Panel -->
						<div id="cp-preview-form-panel" style="flex-grow:1; padding:1.25rem; display:flex; flex-direction:column; gap:0.75rem; overflow-y:auto; max-height:400px;">
							<p style="font-size:0.8rem; color:var(--text-secondary); margin:0; line-height:1.4; text-align:center;">
								Please introduce yourself to start the conversation.
							</p>
							
							<div id="cp-preview-error-msg" style="display:none; color:#ef4444; font-size:0.8rem; border:1px solid rgba(239,68,68,0.2); background:rgba(239,68,68,0.08); padding:0.5rem 0.75rem; border-radius:6px; line-height:1.4;"></div>

							<!-- Dynamic fields container -->
							<div id="cp-preview-fields-container" style="display:flex; flex-direction:column; gap:0.75rem; margin-top:0.25rem;">
								<!-- Rendered in real-time by JS script -->
							</div>

							<div style="margin-top:auto; padding-top:0.5rem;">
								<button type="button" id="cp-preview-submit-btn" class="cp-btn cp-btn-primary" style="margin:0; width:100%; padding:0.5rem 0.75rem; font-size:0.8rem; border-radius:6px;">Start Chat</button>
							</div>
						</div>

						<!-- Interactive Chat Stream Panel (Hidden initially) -->
						<div id="cp-preview-chat-panel" style="display:none; flex-direction:column; flex-grow:1; height:100%;">
							<div id="cp-preview-chat-messages" style="flex-grow:1; padding:1rem; overflow-y:auto; display:flex; flex-direction:column; gap:0.75rem; max-height:300px; font-size:0.85rem;">
								<div style="align-self:flex-start; max-width:85%; background:rgba(30,41,59,0.85); border:1px solid rgba(255,255,255,0.05); color:#e2e8f0; padding:0.6rem 0.85rem; border-radius:10px; border-top-left-radius:3px; line-height:1.4;">
									Hi there! How can I help you today?
								</div>
							</div>
							
							<div style="padding:0.6rem 0.75rem; border-top:1px solid rgba(255,255,255,0.05); background:rgba(0,0,0,0.3);">
								<form id="cp-preview-chat-input-form" style="display:flex; gap:0.4rem; margin:0;">
									<input type="text" id="cp-preview-chat-input" class="cp-input" placeholder="Type a message..." style="flex-grow:1; height:32px; font-size:0.8rem; margin:0 !important;" autocomplete="off">
									<button type="submit" class="cp-btn cp-btn-primary" style="margin:0; height:32px; padding:0 0.6rem; font-size:0.75rem;">Send</button>
								</form>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>

	<?php else : ?>
		<!-- ================= SUBMISSIONS MANAGER VIEW ================= -->
		<div class="cp-card" style="padding:1.5rem;">
			<h3 class="cp-card-title" style="margin-bottom:1.5rem; color:var(--accent-orange);">
				📥 <?php esc_html_e( 'Ingested Lead Submissions', 'chat-pilot' ); ?>
			</h3>

			<!-- Filtering bar -->
			<form id="cp-submissions-filter-form" method="GET" style="display:grid; grid-template-columns: repeat(5, 1fr) 100px; gap:0.75rem; align-items:end; margin-bottom:1.5rem; background:rgba(0,0,0,0.15); border:1px solid rgba(255,255,255,0.03); border-radius:8px; padding:1rem;">
				<input type="hidden" name="page" value="chat-pilot">
				<input type="hidden" name="tab" value="forms">
				<input type="hidden" name="sub_tab" value="submissions">
				
				<!-- Filter Form -->
				<div class="cp-form-group" style="margin:0;">
					<label class="cp-label" style="font-size:0.75rem;"><?php esc_html_e( 'Filter by Form', 'chat-pilot' ); ?></label>
					<select name="filter_form_id" class="cp-input" style="height:38px; min-height:38px; padding:0 0.75rem; line-height:36px; color:#ffffff !important; -webkit-text-fill-color:#ffffff !important; background-color:#1e293b !important; color-scheme:dark !important;">
						<option value=""><?php esc_html_e( '— All Forms —', 'chat-pilot' ); ?></option>
						<?php foreach ( $forms as $f ) : ?>
							<option value="<?php echo esc_attr( $f['id'] ); ?>" <?php selected( !empty($_GET['filter_form_id']) ? intval($_GET['filter_form_id']) : 0, $f['id'] ); ?>>
								<?php echo esc_html( $f['name'] ); ?>
							</option>
						<?php endforeach; ?>
					</select>
				</div>

				<!-- Search details -->
				<div class="cp-form-group" style="margin:0;">
					<label class="cp-label" style="font-size:0.75rem;"><?php esc_html_e( 'Search Contact Details', 'chat-pilot' ); ?></label>
					<input type="text" name="sub_search" class="cp-input" value="<?php echo esc_attr( isset($_GET['sub_search']) ? $_GET['sub_search'] : '' ); ?>" placeholder="Name, Email, Phone..." style="height:38px;">
				</div>

				<!-- Date From -->
				<div class="cp-form-group" style="margin:0;">
					<label class="cp-label" style="font-size:0.75rem;"><?php esc_html_e( 'Date From', 'chat-pilot' ); ?></label>
					<input type="date" name="date_from" class="cp-input" value="<?php echo esc_attr( isset($_GET['date_from']) ? $_GET['date_from'] : '' ); ?>" style="height:38px;">
				</div>

				<!-- Date To -->
				<div class="cp-form-group" style="margin:0;">
					<label class="cp-label" style="font-size:0.75rem;"><?php esc_html_e( 'Date To', 'chat-pilot' ); ?></label>
					<input type="date" name="date_to" class="cp-input" value="<?php echo esc_attr( isset($_GET['date_to']) ? $_GET['date_to'] : '' ); ?>" style="height:38px;">
				</div>

				<!-- Filter buttons -->
				<div style="display:flex; gap:0.4rem;">
					<button type="submit" class="cp-btn cp-btn-primary" style="margin:0; width:100%; padding:0.55rem 0.5rem; font-size:0.8rem;">🔍 Filter</button>
				</div>
				<div>
					<a href="?page=chat-pilot&tab=forms&sub_tab=submissions" class="cp-btn cp-btn-secondary" style="margin:0; display:block; text-align:center; padding:0.55rem 0.5rem; font-size:0.8rem;">Reset</a>
				</div>
			</form>

			<!-- Submissions table -->
			<div style="overflow-x:auto;">
				<table class="cp-kb-table" style="width:100%; border-collapse:collapse; text-align:left; font-size:0.85rem;">
					<thead>
						<tr style="border-bottom:1px solid rgba(255,255,255,0.06); background:rgba(255,255,255,0.02);">
							<th style="padding:0.75rem 1rem;"><?php esc_html_e( 'Date & Time', 'chat-pilot' ); ?></th>
							<th style="padding:0.75rem 1rem;"><?php esc_html_e( 'Lead Contact Info', 'chat-pilot' ); ?></th>
							<th style="padding:0.75rem 1rem;"><?php esc_html_e( 'Form Utilized', 'chat-pilot' ); ?></th>
							<th style="padding:0.75rem 1rem;"><?php esc_html_e( 'Custom Data Summary', 'chat-pilot' ); ?></th>
							<th style="padding:0.75rem 1rem;"><?php esc_html_e( 'Linked Chat', 'chat-pilot' ); ?></th>
							<th style="padding:0.75rem 1rem; text-align:center;"><?php esc_html_e( 'Actions', 'chat-pilot' ); ?></th>
						</tr>
					</thead>
					<tbody>
						<?php if ( empty( $submissions ) ) : ?>
							<tr>
								<td colspan="6" style="padding:3rem; text-align:center; color:var(--text-secondary);">
									<?php esc_html_e( 'No lead submissions found matching filters.', 'chat-pilot' ); ?>
								</td>
							</tr>
						<?php else : ?>
							<?php foreach ( $submissions as $sub ) : ?>
								<?php
								$form_details = $form_manager->get_form( $sub['form_id'] );
								$form_name = $form_details ? $form_details['name'] : esc_html__('Deleted Form', 'chat-pilot');
								?>
								<tr style="border-bottom:1px solid rgba(255,255,255,0.04); transition:all 0.15s ease;" class="cp-submission-row">
									<td style="padding:0.8rem 1rem; font-family:monospace; color:var(--text-secondary);">
										<?php echo esc_html( date( 'Y-m-d H:i:s', strtotime( $sub['created_at'] ) ) ); ?>
									</td>
									<td style="padding:0.8rem 1rem;">
										<div style="font-weight:700; color:#ffffff;"><?php echo esc_html( !empty($sub['name']) ? $sub['name'] : '— Anonymous' ); ?></div>
										<div style="font-size:0.75rem; color:var(--text-muted);"><?php echo esc_html( $sub['email'] ); ?></div>
										<?php if ( ! empty($sub['phone']) ) : ?>
											<div style="font-size:0.75rem; color:var(--text-muted);"><?php echo esc_html( $sub['phone'] ); ?></div>
										<?php endif; ?>
									</td>
									<td style="padding:0.8rem 1rem; color:var(--accent-cyan); font-weight:600;">
										<?php echo esc_html( $form_name ); ?>
									</td>
									<td style="padding:0.8rem 1rem; max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
										<?php if ( ! empty( $sub['custom_fields'] ) && is_array( $sub['custom_fields'] ) ) : ?>
											<div style="font-size:0.75rem; color:var(--text-secondary);">
												<?php
												$pairs = array();
												foreach ( $sub['custom_fields'] as $k => $v ) {
													$pairs[] = esc_html( $k ) . ': ' . esc_html( is_array($v) ? implode(', ', $v) : $v );
												}
												echo esc_html( implode( ' | ', $pairs ) );
												?>
											</div>
										<?php else : ?>
											<span style="color:var(--text-muted);">— No custom fields</span>
										<?php endif; ?>
									</td>
									<td style="padding:0.8rem 1rem;">
										<?php
										$linked_conv_id = ! empty( $sub['conversation_id'] ) ? intval( $sub['conversation_id'] ) : 0;
										if ( ! $linked_conv_id && ! empty( $sub['session_id'] ) ) {
											global $wpdb;
											$ctable = $wpdb->prefix . 'chat_pilot_conversations';
											$crow   = $wpdb->get_row( $wpdb->prepare( "SELECT id FROM {$ctable} WHERE session_id = %s LIMIT 1", $sub['session_id'] ), ARRAY_A );
											if ( $crow ) {
												$linked_conv_id = intval( $crow['id'] );
												$stable = $wpdb->prefix . 'chat_pilot_form_submissions';
												$wpdb->update( $stable, array( 'conversation_id' => $linked_conv_id ), array( 'id' => $sub['id'] ) );
											}
										}
										?>
										<?php if ( ! empty( $linked_conv_id ) ) : ?>
											<a href="?page=chat-pilot&tab=conversations&conv_id=<?php echo esc_attr( $linked_conv_id ); ?>" class="cp-btn cp-btn-sm cp-btn-secondary" style="margin:0; font-size:0.75rem; padding:0.25rem 0.5rem; display:inline-block; border-color:var(--accent-purple); color:var(--accent-purple);">
												💬 View Chat #<?php echo esc_html( $linked_conv_id ); ?>
											</a>
										<?php else : ?>
											<span style="color:var(--text-muted); font-size:0.75rem;">No active chat</span>
										<?php endif; ?>
									</td>
									<td style="padding:0.8rem 1rem; text-align:center;">
										<div style="display:flex; justify-content:center; gap:0.5rem;">
											<button type="button" class="cp-btn cp-btn-sm cp-btn-secondary cp-view-sub-btn" data-sub-id="<?php echo esc_attr( $sub['id'] ); ?>" style="margin:0; font-size:0.75rem; padding:0.25rem 0.5rem;">View</button>
											<button type="button" class="cp-btn cp-btn-sm cp-btn-secondary cp-delete-sub-btn" data-sub-id="<?php echo esc_attr( $sub['id'] ); ?>" style="margin:0; font-size:0.75rem; padding:0.25rem 0.5rem; color:#ef4444; border-color:rgba(239,68,68,0.25);">Delete</button>
										</div>
									</td>
								</tr>
							<?php endforeach; ?>
						<?php endif; ?>
					</tbody>
				</table>
			</div>
		</div>

		<!-- View Submission Modal -->
		<div id="cp-submission-details-modal" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); z-index:99999; align-items:center; justify-content:center; backdrop-filter:blur(3px);">
			<div class="cp-card" style="width: 500px; max-width:90%; padding:1.5rem; display:flex; flex-direction:column; gap:1.25rem; border:1px solid rgba(255,255,255,0.08); background:var(--bg-slate-900);">
				<h3 class="cp-card-title" style="margin:0; border-bottom:1px solid rgba(255,255,255,0.06); padding-bottom:0.75rem; color:var(--accent-orange); display:flex; justify-content:space-between; align-items:center;">
					<span>Lead Submission Details</span>
					<button type="button" id="cp-close-modal-btn" style="background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:1.1rem;">✕</button>
				</h3>

				<div style="display:flex; flex-direction:column; gap:0.75rem; max-height:400px; overflow-y:auto; padding-right:5px;" id="cp-modal-fields-list">
					<!-- Populated by JS -->
				</div>

				<div style="border-top:1px solid rgba(255,255,255,0.06); padding-top:1rem; display:flex; justify-content:flex-end;">
					<button type="button" id="cp-close-modal-bottom-btn" class="cp-btn cp-btn-secondary" style="margin:0;">Close Details</button>
				</div>
			</div>
		</div>
	<?php endif; ?>
</div>

<!-- Raw data scripts to bootstrap Form builder -->
<script type="text/javascript">
window.chatPilotBuilderForms = <?php echo wp_json_encode( array_map(function($f){
	return array(
		'id' => $f['id'],
		'name' => $f['name'],
		'is_default' => $f['is_default'],
		'status' => $f['status'],
		'fields' => $f['fields']
	);
}, $forms) ); ?>;
</script>
