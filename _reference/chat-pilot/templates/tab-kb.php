<?php
/**
 * Tab Knowledge Base Redesigned Template with Redesigned Workspaces
 */

// Prevent direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$kb_manager = new \ChatPilot\KB\KBManager();
$sources    = $kb_manager->get_sources();
$documents  = $kb_manager->get_documents();

// Calculate metrics.
$total_sources = count( $sources );
$total_docs    = count( $documents );
$total_words   = 0;
foreach ( $documents as $doc ) {
	if ( 'enabled' === $doc['status'] ) {
		$total_words += intval( $doc['word_count'] );
	}
}

// Evaluate overall system sync health.
$all_healthy = true;
foreach ( $sources as $src ) {
	if ( 'failed' === $src['status'] ) {
		$all_healthy = false;
		break;
	}
}
$health_status = empty( $sources ) ? esc_html__( 'Idle', 'chat-pilot' ) : ($all_healthy ? esc_html__( '100% Synced', 'chat-pilot' ) : esc_html__( 'Sync Errors', 'chat-pilot' ));
?>

<div class="cp-kb-dashboard-wrapper">

	<!-- 1. Hero Header Section -->
	<section class="cp-kb-hero">
		<div class="cp-kb-hero-content">
			<h2><?php esc_html_e( 'Knowledge Base', 'chat-pilot' ); ?></h2>
			<p><?php esc_html_e( 'Teach Chat Pilot about your business by importing website content, uploading documents, creating manual knowledge, or managing FAQs.', 'chat-pilot' ); ?></p>
		</div>
	</section>

	<!-- 5. Modern SaaS KPI Cards Grid -->
	<section class="cp-kb-kpi-grid mb-8">
		<div class="cp-kpi-card">
			<div class="kpi-icon">📚</div>
			<div class="kpi-details">
				<span class="kpi-label"><?php esc_html_e( 'Knowledge Sources', 'chat-pilot' ); ?></span>
				<span class="kpi-val"><?php echo esc_html( $total_sources ); ?></span>
			</div>
		</div>
		<div class="cp-kpi-card">
			<div class="kpi-icon">📄</div>
			<div class="kpi-details">
				<span class="kpi-label"><?php esc_html_e( 'Index Pages / Docs', 'chat-pilot' ); ?></span>
				<span class="kpi-val"><?php echo esc_html( $total_docs ); ?></span>
			</div>
		</div>
		<div class="cp-kpi-card">
			<div class="kpi-icon">🔤</div>
			<div class="kpi-details">
				<span class="kpi-label"><?php esc_html_e( 'Active Word Count', 'chat-pilot' ); ?></span>
				<span class="kpi-val"><?php echo esc_html( number_format( $total_words ) ); ?></span>
			</div>
		</div>
		<div class="cp-kpi-card">
			<div class="kpi-icon">🛡️</div>
			<div class="kpi-details">
				<span class="kpi-label"><?php esc_html_e( 'Retrieval Health', 'chat-pilot' ); ?></span>
				<span class="kpi-val <?php echo $all_healthy ? 'text-success' : 'text-danger'; ?>">
					<?php echo esc_html( $health_status ); ?>
				</span>
			</div>
		</div>
	</section>

	<!-- 2. SaaS Ingestion Onboarding Cards -->
	<section class="cp-kb-onboarding mb-8">
		<h3 class="cp-kb-section-title mb-4"><?php esc_html_e( 'Add Knowledge Ingestion Source', 'chat-pilot' ); ?></h3>
		<div class="cp-kb-cards-grid">
			
			<div class="cp-ingest-card" data-source="website">
				<div class="ingest-card-icon">🌐</div>
				<h4><?php esc_html_e( 'Website Scanner', 'chat-pilot' ); ?></h4>
				<p><?php esc_html_e( 'Crawl site URLs, map pages hierarchy, and extract clean text blocks, ignoring navigation layout templates.', 'chat-pilot' ); ?></p>
				<button type="button" class="cp-btn cp-btn-primary card-action-btn"><?php esc_html_e( 'Scan Website', 'chat-pilot' ); ?></button>
			</div>

			<div class="cp-ingest-card" data-source="file">
				<div class="ingest-card-icon">📁</div>
				<h4><?php esc_html_e( 'Document Upload', 'chat-pilot' ); ?></h4>
				<p><?php esc_html_e( 'Upload PDF, DOCX, or TXT documents. Extraction is handled locally and securely on your own server.', 'chat-pilot' ); ?></p>
				<button type="button" class="cp-btn cp-btn-primary card-action-btn"><?php esc_html_e( 'Upload Documents', 'chat-pilot' ); ?></button>
			</div>

			<div class="cp-ingest-card" data-source="manual">
				<div class="ingest-card-icon">📝</div>
				<h4><?php esc_html_e( 'Manual Entry', 'chat-pilot' ); ?></h4>
				<p><?php esc_html_e( 'Type or paste custom business details, policies, internal memos, or guidelines directly into the engine.', 'chat-pilot' ); ?></p>
				<button type="button" class="cp-btn cp-btn-primary card-action-btn"><?php esc_html_e( 'Create Entry', 'chat-pilot' ); ?></button>
			</div>

			<div class="cp-ingest-card" data-source="faq">
				<div class="ingest-card-icon">❓</div>
				<h4><?php esc_html_e( 'FAQ Manager', 'chat-pilot' ); ?></h4>
				<p><?php esc_html_e( 'Define standard Q&As frequently requested by website customers, loaded with priority matching.', 'chat-pilot' ); ?></p>
				<button type="button" class="cp-btn cp-btn-primary card-action-btn"><?php esc_html_e( 'Build Q&As', 'chat-pilot' ); ?></button>
			</div>

		</div>
	</section>

	<!-- 3. Dynamic Focused Ingestion Workspace Panel -->
	<section class="cp-kb-workspace-container mb-8" id="cp-kb-workspace-container" style="display:none;">
		<div class="cp-card">
			<div class="cp-card-header cp-kb-workspace-header">
				<div class="workspace-title-block">
					<span class="workspace-badge" id="cp-kb-workspace-badge">SOURCE</span>
					<h3 id="cp-kb-workspace-title">Workspace Form</h3>
				</div>
				<button type="button" class="cp-workspace-close" id="cp-kb-workspace-close" title="<?php esc_attr_e( 'Close Panel', 'chat-pilot' ); ?>">&times;</button>
			</div>
			<div class="cp-card-body">
				
				<!-- Workspace form: Website Scanner (Redesigned 2-Column Layout) -->
				<div id="kb-form-website" class="cp-workspace-form-content">
					<div class="cp-workspace-grid">
						<div class="cp-workspace-main">
							<form id="cp-kb-website-form" class="cp-form">
								<?php wp_nonce_field( 'chat_pilot_admin_nonce' ); ?>
								<div class="form-group mb-5">
									<label class="cp-workspace-form-label" for="kb_website_url"><?php esc_html_e( 'Target Website URL', 'chat-pilot' ); ?></label>
									<input type="url" id="kb_website_url" name="url" placeholder="https://example.com/docs" class="cp-input cp-input-lg" required>
									<small class="cp-help-text mt-2"><?php esc_html_e( 'Specify the seed web address. The crawler will crawl internal pages and parse readable content.', 'chat-pilot' ); ?></small>
								</div>
								<div class="form-group mb-5">
									<label class="cp-workspace-form-label" for="kb_website_max_pages"><?php esc_html_e( 'Crawl Pages Limit', 'chat-pilot' ); ?></label>
									<select id="kb_website_max_pages" name="max_pages" class="cp-input cp-input-lg">
										<option value="5">5 <?php esc_html_e( 'pages', 'chat-pilot' ); ?></option>
										<option value="15" selected>15 <?php esc_html_e( 'pages (Recommended)', 'chat-pilot' ); ?></option>
										<option value="30">30 <?php esc_html_e( 'pages', 'chat-pilot' ); ?></option>
										<option value="50">50 <?php esc_html_e( 'pages (Max Limit)', 'chat-pilot' ); ?></option>
									</select>
								</div>
								<button type="submit" class="cp-btn cp-btn-primary cp-btn-lg cp-btn-glow" id="cp-crawler-start-btn">
									<span class="cp-btn-spinner" style="display:none;"></span>
									<?php esc_html_e( 'Start Crawling & Import', 'chat-pilot' ); ?>
								</button>
							</form>

							<!-- Crawler Live Progress Console -->
							<div id="cp-crawler-progress-container" style="display:none; margin-top: 2rem; background: rgba(0, 0, 0, 0.4); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 12px; padding: 1.5rem; font-family: 'Fira Code', Consolas, monospace;">
								<h4 style="margin:0 0 1rem 0; font-size: 1rem; color: #ffffff; display: flex; align-items: center; justify-content: space-between;">
									<span>🔄 Website Scan Progress</span>
									<span id="cp-crawler-progress-percent" style="font-size:0.85rem; color: var(--accent-cyan);">0%</span>
								</h4>
								<div class="cp-progress-bar mb-3" style="height: 6px; background: rgba(255, 255, 255, 0.05); border-radius: 4px; overflow: hidden; position: relative;">
									<div id="cp-crawler-progress-bar-fill" style="width: 0%; height: 100%; background: linear-gradient(90deg, var(--accent-cyan), var(--accent-blue)); transition: width 0.3s ease;"></div>
								</div>
								<div id="cp-crawler-progress-logs" style="max-height: 180px; overflow-y: auto; font-size: 0.85rem; line-height: 1.6; color: #cbd5e1; padding: 0.5rem; background: rgba(0,0,0,0.2); border-radius: 6px; border: 1px solid rgba(255,255,255,0.03);"></div>
								<div style="margin-top: 1.25rem; text-align: right;">
									<button type="button" id="cp-crawler-cancel-btn" class="cp-btn cp-btn-sm" style="background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); font-size: 0.85rem; border-radius: 6px;"><?php esc_html_e( 'Cancel Scan', 'chat-pilot' ); ?></button>
								</div>
							</div>

							<!-- Scan Completion Summary & Verification Center -->
							<div id="cp-crawler-summary-container" style="display:none; margin-top: 2.5rem; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 2.5rem;">
								<div class="cp-card" style="background: rgba(255,255,255,0.02); border-color: rgba(255,255,255,0.06); margin-bottom: 2rem;">
									<div class="cp-card-header" style="border-bottom: 1px solid rgba(255,255,255,0.04); display:flex; align-items:center; justify-content:space-between; padding: 1.25rem 1.5rem;">
										<h4 style="margin:0; font-family:'Outfit'; color:#ffffff; font-size:1.15rem; font-weight:700;">🎉 Website Scan Complete</h4>
										<span class="badge" style="background:rgba(34,197,94,0.15); color:#4ade80; padding:0.25rem 0.75rem; border-radius:12px; font-size:0.8rem; font-weight:600;">Completed Successfully</span>
									</div>
									<div class="cp-card-body" style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 1.5rem; padding: 1.5rem;">
										<div>
											<span style="font-size:0.8rem; color:#94a3b8; text-transform:uppercase; display:block; font-weight:600; letter-spacing:0.05em; margin-bottom:0.25rem;">Target Website</span>
											<strong id="cp-summary-url" style="color:#ffffff; font-size:0.95rem; word-break:break-all;">-</strong>
										</div>
										<div>
											<span style="font-size:0.8rem; color:#94a3b8; text-transform:uppercase; display:block; font-weight:600; letter-spacing:0.05em; margin-bottom:0.25rem;">Scan Duration</span>
											<strong id="cp-summary-duration" style="color:#ffffff; font-size:0.95rem;">-</strong>
										</div>
										<div>
											<span style="font-size:0.8rem; color:#94a3b8; text-transform:uppercase; display:block; font-weight:600; letter-spacing:0.05em; margin-bottom:0.25rem;">Pages Discovered</span>
											<strong id="cp-summary-discovered" style="color:#ffffff; font-size:0.95rem;">-</strong>
										</div>
										<div>
											<span style="font-size:0.8rem; color:#94a3b8; text-transform:uppercase; display:block; font-weight:600; letter-spacing:0.05em; margin-bottom:0.25rem;">Pages Imported</span>
											<strong id="cp-summary-imported" style="color:#ffffff; font-size:0.95rem;">-</strong>
										</div>
										<div>
											<span style="font-size:0.8rem; color:#94a3b8; text-transform:uppercase; display:block; font-weight:600; letter-spacing:0.05em; margin-bottom:0.25rem;">Documents Created</span>
											<strong id="cp-summary-documents" style="color:#ffffff; font-size:0.95rem;">-</strong>
										</div>
										<div>
											<span style="font-size:0.8rem; color:#94a3b8; text-transform:uppercase; display:block; font-weight:600; letter-spacing:0.05em; margin-bottom:0.25rem;">Pages Skipped / Failed</span>
											<strong id="cp-summary-skipped" style="color:#ffffff; font-size:0.95rem;">-</strong>
										</div>
									</div>
								</div>

								<!-- Imported Pages List -->
								<h4 style="color:#ffffff; font-family:'Outfit'; margin: 0 0 0.5rem 0; font-size:1.15rem; font-weight:700;">📄 Imported Pages Checklist</h4>
								<p style="color:#94a3b8; font-size:0.85rem; margin-bottom:1.25rem;">Click any page path below to inspect the clean, extracted text document preview.</p>
								<div id="cp-summary-pages-list" style="background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.06); border-radius:10px; max-height:280px; overflow-y:auto; padding:0.5rem;">
								</div>
							</div>
						</div>
						<div class="cp-workspace-sidebar">
							<!-- How it works card -->
							<div class="cp-sidebar-info-card" id="cp-crawler-help-sidebar" style="margin-bottom: 1.5rem;">
								<h4>🌐 <?php esc_html_e( 'How the Web Scanner Works', 'chat-pilot' ); ?></h4>
								<ul>
									<li>
										<strong><?php esc_html_e( 'What is extracted:', 'chat-pilot' ); ?></strong>
										<p><?php esc_html_e( 'Main headers (H1-H3), bullet points, standard text paragraphs, and data tables.', 'chat-pilot' ); ?></p>
									</li>
									<li>
										<strong><?php esc_html_e( 'What is ignored:', 'chat-pilot' ); ?></strong>
										<p><?php esc_html_e( 'Site navigation headers, footer copyright widgets, sidebars, and script widgets.', 'chat-pilot' ); ?></p>
									</li>
									<li>
										<strong><?php esc_html_e( 'Estimated Speed:', 'chat-pilot' ); ?></strong>
										<p><?php esc_html_e( 'Takes ~1-2 seconds per page depending on network latency.', 'chat-pilot' ); ?></p>
									</li>
								</ul>
							</div>

							<!-- Scan History Log Sidebar (Dynamic) -->
							<div class="cp-sidebar-info-card" id="cp-crawler-history-sidebar" style="display:none; margin-bottom: 1.5rem; background: rgba(255,255,255,0.01); border-color: rgba(255,255,255,0.04);">
								<h4 style="color:#ffffff; font-family:'Outfit'; font-size:1.05rem; margin-bottom:1rem;">📅 Scan History</h4>
								<div class="cp-history-list-wrapper" style="max-height: 240px; overflow-y: auto;">
									<!-- Filled Dynamically -->
								</div>
							</div>

							<!-- Retrieval Verification Block -->
							<div class="cp-sidebar-info-card" id="cp-crawler-retrieval-sidebar" style="display:none; background: rgba(6, 182, 212, 0.02); border-color: rgba(6,182,212,0.15);">
								<h4 style="color:#ffffff; font-family:'Outfit'; font-size:1.05rem; display:flex; align-items:center; gap:0.5rem;">🔍 Test Imported Knowledge</h4>
								<p style="color:#94a3b8; font-size:0.85rem; line-height:1.5; margin-bottom:1.25rem;">Submit test queries targeting only this website source to verify searchability.</p>
								<form id="cp-crawler-test-search-form" style="margin-bottom:1.5rem;">
									<input type="hidden" id="cp-test-search-source-id" value="">
									<div class="form-group" style="margin-bottom:1rem !important;">
										<input type="text" id="cp-test-search-query" placeholder="Type test question (e.g. refund)" class="cp-input" style="padding:0.65rem 0.85rem !important; font-size:0.9rem !important;" required>
									</div>
									<button type="submit" class="cp-btn cp-btn-primary cp-btn-glow" style="width:100%; padding:0.65rem !important; font-size:0.9rem !important;">Test Retrieval</button>
								</form>
								<div id="cp-test-search-results" style="max-height: 280px; overflow-y: auto; background: rgba(0,0,0,0.15); border-radius:6px; padding:0.5rem;">
									<span style="font-size:0.8rem; color:#94a3b8; font-style:italic; padding:0.25rem; display:block;">No search query executed yet.</span>
								</div>
							</div>
						</div>
					</div>
				</div>

				<!-- Workspace form: File Upload (Redesigned 2-Column Layout) -->
				<div id="kb-form-file" class="cp-workspace-form-content">
					<div class="cp-workspace-grid">
						<div class="cp-workspace-main">
							<div class="cp-file-drag-zone" id="cp-file-drag-zone">
								<span class="drag-icon">📥</span>
								<h4><?php esc_html_e( 'Drag & Drop your document here', 'chat-pilot' ); ?></h4>
								<p><?php esc_html_e( 'Supports PDF, DOCX, and TXT files up to 10MB', 'chat-pilot' ); ?></p>
								<span class="file-or"><?php esc_html_e( 'or', 'chat-pilot' ); ?></span>
								<label for="kb_file_select" class="cp-btn cp-btn-secondary"><?php esc_html_e( 'Browse Local Files', 'chat-pilot' ); ?></label>
								<input type="file" id="kb_file_select" accept=".pdf,.docx,.txt" style="display:none;">
								<div id="cp-file-upload-status" class="mt-4" style="display:none; width: 100%; max-width: 300px; margin: 1rem auto;">
									<div class="cp-progress-bar">
										<div class="cp-progress-fill" style="width: 0%;"></div>
									</div>
									<p class="status-msg mt-2" style="font-size:0.85rem; color:var(--text-secondary);"></p>
								</div>
							</div>
						</div>
						<div class="cp-workspace-sidebar">
							<div class="cp-sidebar-info-card">
								<h4>🔒 <?php esc_html_e( 'Secure Local Extraction', 'chat-pilot' ); ?></h4>
								<ul>
									<li>
										<strong><?php esc_html_e( 'Zero Cloud Processing:', 'chat-pilot' ); ?></strong>
										<p><?php esc_html_e( 'All text extraction routines are processed locally on your server. Your data never leaves your environment.', 'chat-pilot' ); ?></p>
									</li>
									<li>
										<strong><?php esc_html_e( 'PDF Stream Decompression:', 'chat-pilot' ); ?></strong>
										<p><?php esc_html_e( 'Native zlib decompressor processes standard PDF binary streams instantly.', 'chat-pilot' ); ?></p>
									</li>
									<li>
										<strong><?php esc_html_e( 'Word Document XML parsing:', 'chat-pilot' ); ?></strong>
										<p><?php esc_html_e( 'Unzips DOCX elements to extract text layers without formatting loss.', 'chat-pilot' ); ?></p>
									</li>
								</ul>
							</div>
						</div>
					</div>
				</div>

				<!-- Workspace form: Manual Knowledge Entry (Redesigned SaaS Notion-like Editor) -->
				<div id="kb-form-manual" class="cp-workspace-form-content">
					<form id="cp-kb-manual-form" class="cp-form cp-saas-editor-form">
						<?php wp_nonce_field( 'chat_pilot_admin_nonce' ); ?>
						<input type="hidden" name="source_id" id="kb_manual_source_id" value="">
						
						<!-- Notion-like Borderless Title Input -->
						<div class="form-group mb-4">
							<input type="text" id="kb_manual_title" name="title" placeholder="<?php esc_attr_e( 'Untitled Knowledge Document', 'chat-pilot' ); ?>" class="cp-editor-title" required>
						</div>

						<!-- Metadata inline row -->
						<div class="form-row mb-5">
							<div class="form-group col-6 pr-3">
								<label class="cp-editor-meta-label" for="kb_manual_category"><?php esc_html_e( 'Category', 'chat-pilot' ); ?></label>
								<input type="text" id="kb_manual_category" name="category" placeholder="e.g. Policies, Billing" class="cp-input cp-input-sm cp-editor-meta-input">
							</div>
							<div class="form-group col-6 pl-3">
								<label class="cp-editor-meta-label" for="kb_manual_tags"><?php esc_html_e( 'Tags (comma separated)', 'chat-pilot' ); ?></label>
								<input type="text" id="kb_manual_tags" name="tags" placeholder="e.g. refund, rules" class="cp-input cp-input-sm cp-editor-meta-input">
							</div>
						</div>

						<!-- Content Editor Body -->
						<div class="form-group mb-5">
							<label class="cp-workspace-form-label" for="kb_manual_content"><?php esc_html_e( 'Document Content', 'chat-pilot' ); ?></label>
							<textarea id="kb_manual_content" name="content" rows="12" placeholder="<?php esc_attr_e( 'Start writing or paste your business instructions here...', 'chat-pilot' ); ?>" class="cp-input cp-editor-textarea" required></textarea>
						</div>

						<button type="submit" class="cp-btn cp-btn-primary cp-btn-lg cp-btn-glow" id="kb-manual-btn-submit">
							<span class="cp-btn-spinner" style="display:none;"></span>
							<?php esc_html_e( 'Save Knowledge Entry', 'chat-pilot' ); ?>
						</button>
					</form>
				</div>

				<!-- Workspace form: FAQ Entry (Redesigned SaaS QA Layout) -->
				<div id="kb-form-faq" class="cp-workspace-form-content">
					<form id="cp-kb-faq-form" class="cp-form cp-saas-editor-form">
						<?php wp_nonce_field( 'chat_pilot_admin_nonce' ); ?>
						<input type="hidden" name="source_id" id="kb_faq_source_id" value="">
						
						<!-- Bulk Editor Paste (Show in Create Mode) -->
						<div id="cp-faq-bulk-container" class="form-group mb-5">
							<label class="cp-workspace-form-label" for="kb_faq_bulk_paste"><?php esc_html_e( 'Bulk FAQ Paste', 'chat-pilot' ); ?></label>
							<p style="font-size:0.85rem; color:#94a3b8; margin-top:-0.25rem; margin-bottom:1rem;">
								<?php esc_html_e( 'Paste your entire FAQs list below. Format each pair with Q: (Question) and A: (Answer). For example:', 'chat-pilot' ); ?>
								<br><code style="color:var(--accent-glow); font-size:0.8rem; background:rgba(0,0,0,0.25); padding:0.1rem 0.3rem; border-radius:3px; font-family:monospace; margin-top:0.25rem; display:inline-block;">Q: Do you offer same-day service?</code>
								<br><code style="color:var(--accent-glow); font-size:0.8rem; background:rgba(0,0,0,0.25); padding:0.1rem 0.3rem; border-radius:3px; font-family:monospace; margin-top:0.1rem; display:inline-block;">A: Yes, call before 10 AM.</code>
							</p>
							<textarea id="kb_faq_bulk_paste" name="bulk_paste" rows="12" placeholder="<?php esc_attr_e( "Q: What services do you provide?\nA: We offer roll-off dumpster rentals and demolition services.\n\nQ: Do you serve Hillsborough County?\nA: Yes, we cover Tampa, Brandon, and surrounding areas.", 'chat-pilot' ); ?>" class="cp-input cp-editor-textarea" required></textarea>
						</div>

						<!-- Single Editor (Shown dynamically in Edit Mode) -->
						<div id="cp-faq-single-container" style="display:none;">
							<!-- Large Question Input -->
							<div class="form-group mb-5">
								<label class="cp-workspace-form-label" for="kb_faq_question"><?php esc_html_e( 'Question Title', 'chat-pilot' ); ?></label>
								<input type="text" id="kb_faq_question" name="question" placeholder="<?php esc_attr_e( 'What is the visitor asking?', 'chat-pilot' ); ?>" class="cp-editor-title qa-question-input">
							</div>

							<!-- Clean Answer Textarea -->
							<div class="form-group mb-5">
								<label class="cp-workspace-form-label" for="kb_faq_answer"><?php esc_html_e( 'Configured Answer', 'chat-pilot' ); ?></label>
								<textarea id="kb_faq_answer" name="answer" rows="8" placeholder="<?php esc_attr_e( 'Provide the clean answer that Chat Pilot will return for matches...', 'chat-pilot' ); ?>" class="cp-input cp-editor-textarea"></textarea>
							</div>
						</div>

						<!-- Metadata inline row (Shared across both modes) -->
						<div class="form-row mb-5">
							<div class="form-group col-6">
								<label class="cp-editor-meta-label" for="kb_faq_category"><?php esc_html_e( 'FAQ Category', 'chat-pilot' ); ?></label>
								<input type="text" id="kb_faq_category" name="category" placeholder="e.g. Delivery, General" class="cp-input cp-input-sm cp-editor-meta-input">
							</div>
						</div>

						<button type="submit" class="cp-btn cp-btn-primary cp-btn-lg cp-btn-glow" id="kb-faq-btn-submit">
							<span class="cp-btn-spinner" style="display:none;"></span>
							<?php esc_html_e( 'Save FAQ Entry', 'chat-pilot' ); ?>
						</button>
					</form>
				</div>

			</div>
		</div>
	</section>

	<!-- 4. Knowledge Sources Overview -->
	<section class="cp-kb-management mb-8">
		<div class="cp-card">
			<div class="cp-card-header">
				<h3><?php esc_html_e( 'Manage Knowledge Sources', 'chat-pilot' ); ?></h3>
				<p><?php esc_html_e( 'View, re-sync, or toggle enabled documents for each knowledge source mapped in the database.', 'chat-pilot' ); ?></p>
			</div>
			<div class="cp-card-body p-0">
				<?php if ( empty( $sources ) ) : ?>
					<div class="cp-kb-empty-state">
						<span class="empty-state-icon">📂</span>
						<h4><?php esc_html_e( 'Your Knowledge Base is Empty', 'chat-pilot' ); ?></h4>
						<p><?php esc_html_e( 'Select one of the ingestion sources above to start feeding knowledge to Chat Pilot.', 'chat-pilot' ); ?></p>
					</div>
				<?php else : ?>
					<div class="table-responsive">
						<table class="cp-table">
							<thead>
								<tr>
									<th><?php esc_html_e( 'Source Name / Configured Location', 'chat-pilot' ); ?></th>
									<th><?php esc_html_e( 'Type', 'chat-pilot' ); ?></th>
									<th><?php esc_html_e( 'Status', 'chat-pilot' ); ?></th>
									<th><?php esc_html_e( 'Last Sync', 'chat-pilot' ); ?></th>
									<th style="text-align:right;"><?php esc_html_e( 'Actions', 'chat-pilot' ); ?></th>
								</tr>
							</thead>
							<tbody>
								<?php foreach ( $sources as $src ) : ?>
									<?php
									$config_data = json_decode( $src['config'], true );
									$sync_time   = $src['last_sync'] ? date_i18n( get_option( 'date_format' ) . ' ' . get_option( 'time_format' ), strtotime( $src['last_sync'] ) ) : esc_html__( 'Never', 'chat-pilot' );
									
									$status_badge_class = 'badge-secondary';
									if ( 'completed' === $src['status'] ) {
										$status_badge_class = 'badge-success';
									} elseif ( 'failed' === $src['status'] ) {
										$status_badge_class = 'badge-danger';
									} elseif ( 'processing' === $src['status'] ) {
										$status_badge_class = 'badge-warning';
									}
									?>
									<tr class="source-row" data-id="<?php echo esc_attr( $src['id'] ); ?>">
										<td>
											<div style="font-weight:600; color:var(--text-primary);">
												<?php echo esc_html( $src['name'] ); ?>
											</div>
											<?php if ( ! empty( $src['error_message'] ) ) : ?>
												<div class="cp-error-text" style="font-size:0.75rem; margin-top:0.25rem;">
													⚠️ <?php echo esc_html( $src['error_message'] ); ?>
												</div>
											<?php endif; ?>
										</td>
										<td>
											<span class="cp-type-label">
												<?php echo esc_html( strtoupper( $src['type'] ) ); ?>
											</span>
										</td>
										<td>
											<span class="cp-badge <?php echo esc_attr( $status_badge_class ); ?>">
												<?php echo esc_html( ucfirst( $src['status'] ) ); ?>
											</span>
										</td>
										<td><?php echo esc_html( $sync_time ); ?></td>
										<td style="text-align:right;">
											<div class="cp-actions-row">
												<button class="cp-action-btn cp-action-sync" data-id="<?php echo esc_attr( $src['id'] ); ?>" title="<?php esc_attr_e( 'Sync Source', 'chat-pilot' ); ?>">🔄</button>
												<?php if ( 'manual' === $src['type'] ) : ?>
													<button class="cp-action-btn cp-action-edit-manual" 
														data-id="<?php echo esc_attr( $src['id'] ); ?>" 
														data-title="<?php echo esc_attr( $src['name'] ); ?>"
														data-content="<?php echo esc_attr( $config_data['content'] ?? '' ); ?>"
														data-category="<?php echo esc_attr( $config_data['category'] ?? '' ); ?>"
														data-tags="<?php echo esc_attr( $config_data['tags'] ?? '' ); ?>"
														title="<?php esc_attr_e( 'Edit Manual Source', 'chat-pilot' ); ?>">✏️</button>
												<?php elseif ( 'faq' === $src['type'] ) : ?>
													<button class="cp-action-btn cp-action-edit-faq" 
														data-id="<?php echo esc_attr( $src['id'] ); ?>" 
														data-question="<?php echo esc_attr( $config_data['question'] ?? '' ); ?>"
														data-answer="<?php echo esc_attr( $config_data['answer'] ?? '' ); ?>"
														data-category="<?php echo esc_attr( $config_data['category'] ?? '' ); ?>"
														title="<?php esc_attr_e( 'Edit FAQ Q&A', 'chat-pilot' ); ?>">✏️</button>
												<?php elseif ( 'website' === $src['type'] ) : ?>
													<button class="cp-action-btn cp-action-rescan-website" 
														data-id="<?php echo esc_attr( $src['id'] ); ?>" 
														data-name="<?php echo esc_attr( $src['name'] ); ?>"
														title="<?php esc_attr_e( 'Rescan Website', 'chat-pilot' ); ?>">🔍</button>
												<?php endif; ?>
												<button class="cp-action-btn cp-action-delete" data-id="<?php echo esc_attr( $src['id'] ); ?>" title="<?php esc_attr_e( 'Delete Source', 'chat-pilot' ); ?>">❌</button>
											</div>
										</td>
									</tr>
									<!-- Collapsible nested documents drawer -->
									<tr class="docs-sub-row" id="docs-sub-<?php echo esc_attr( $src['id'] ); ?>">
										<td colspan="5" class="p-0">
											<div class="docs-accordion-content">
												<h5 class="mb-3"><?php esc_html_e( 'Ingested Knowledge Pages / Document Snippets', 'chat-pilot' ); ?></h5>
												<table class="cp-docs-sub-table">
													<thead>
														<tr>
															<th><?php esc_html_e( 'Title', 'chat-pilot' ); ?></th>
															<th><?php esc_html_e( 'Word Count', 'chat-pilot' ); ?></th>
															<th><?php esc_html_e( 'Source Location', 'chat-pilot' ); ?></th>
															<th><?php esc_html_e( 'Searchable State', 'chat-pilot' ); ?></th>
														</tr>
													</thead>
													<tbody>
														<?php
														$src_docs = array_filter( $documents, function( $d ) use ( $src ) {
															return intval( $d['source_id'] ) === intval( $src['id'] );
														} );
														if ( empty( $src_docs ) ) :
														?>
															<tr>
																<td colspan="4" style="text-align:center; color:var(--text-secondary); font-style:italic;">
																	<?php esc_html_e( 'No snippets generated. Sync the source to process.', 'chat-pilot' ); ?>
																</td>
															</tr>
														<?php else : ?>
															<?php foreach ( $src_docs as $doc ) : ?>
																<tr>
																	<td><strong><?php echo esc_html( $doc['title'] ); ?></strong></td>
																	<td><?php echo esc_html( $doc['word_count'] ); ?> <?php esc_html_e( 'words', 'chat-pilot' ); ?></td>
																	<td>
																		<code style="font-size:0.75rem; color:var(--accent-cyan);">
																			<?php echo esc_html( $doc['source_url'] ); ?>
																		</code>
																	</td>
																	<td>
																		<label class="cp-switch">
																			<input type="checkbox" class="cp-doc-status-toggle" data-id="<?php echo esc_attr( $doc['id'] ); ?>" <?php checked( $doc['status'], 'enabled' ); ?>>
																			<span class="cp-switch-slider"></span>
										</label>
									</td>
								</tr>
															<?php endforeach; ?>
														<?php endif; ?>
													</tbody>
												</table>
											</div>
										</td>
									</tr>
								<?php endforeach; ?>
							</tbody>
						</table>
					</div>
				<?php endif; ?>
			</div>
		</div>
	</section>

	<!-- 6. Developer Tools (Collapsible diagnostics sandbox) -->
	<section class="cp-kb-dev-sandbox mb-8">
		<div class="cp-card">
			<div class="cp-card-header cp-kb-accordion-header" id="cp-kb-dev-toggle">
				<div style="display:flex; align-items:center; gap:0.5rem;">
					<span>🛠️</span>
					<h3><?php esc_html_e( 'Retrieval Diagnostics (Developer Tools)', 'chat-pilot' ); ?></h3>
				</div>
				<span class="accordion-arrow">▼</span>
			</div>
			<div class="cp-card-body cp-kb-accordion-body" style="display:none;" id="cp-kb-dev-body">
				<p class="mb-4" style="font-size:0.85rem; color:var(--text-secondary);">
					<?php esc_html_e( 'Simulate Visitor queries below to verify term-density overlap ranking and search context assembly parameters.', 'chat-pilot' ); ?>
				</p>
				<form id="cp-kb-search-form" class="cp-form mb-4">
					<?php wp_nonce_field( 'chat_pilot_admin_nonce' ); ?>
					<div class="form-group mb-3">
						<input type="text" id="kb_search_query" name="query" placeholder="Type visitor question..." class="cp-input" required>
					</div>
					<button type="submit" class="cp-btn cp-btn-primary">
						<span class="cp-btn-spinner" style="display:none;"></span>
						<?php esc_html_e( 'Run Diagnostics Query', 'chat-pilot' ); ?>
					</button>
				</form>

				<!-- Ranked Search Results -->
				<div id="cp-kb-search-results" style="display:none;">
					<!-- Metadata Card -->
					<div id="cp-kb-diagnostics-summary" class="cp-card mb-4" style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); border-radius: 8px;">
						<div class="cp-card-body" style="padding:1.25rem; display:grid; grid-template-columns: repeat(2, 1fr); gap: 1rem; font-size: 0.9rem;">
							<div>
								<span style="color:#94a3b8; display:block; font-size: 0.8rem; text-transform:uppercase; font-weight: 600;">User Query</span>
								<strong id="cp-diag-summary-query" style="color:#ffffff; font-family:'Outfit';">-</strong>
							</div>
							<div>
								<span style="color:#94a3b8; display:block; font-size: 0.8rem; text-transform:uppercase; font-weight: 600;">Retrieval Status</span>
								<span id="cp-diag-summary-status" style="font-weight:700;">-</span>
							</div>
							<div>
								<span style="color:#94a3b8; display:block; font-size: 0.8rem; text-transform:uppercase; font-weight: 600;">Documents Indexed</span>
								<strong id="cp-diag-summary-total-docs" style="color:#ffffff; font-family:'Outfit';">-</strong>
							</div>
							<div>
								<span style="color:#94a3b8; display:block; font-size: 0.8rem; text-transform:uppercase; font-weight: 600;">Highest Similarity Score</span>
								<strong id="cp-diag-summary-highest-score" style="color:#ffffff; font-family:'Outfit';">-</strong>
							</div>
							<div style="grid-column: span 2; border-top: 1px solid rgba(255,255,255,0.04); padding-top: 0.75rem; margin-top: 0.25rem;">
								<span style="color:#94a3b8; display:block; font-size: 0.8rem; text-transform:uppercase; font-weight: 600;">Configured Confidence Threshold</span>
								<strong id="cp-diag-summary-threshold" style="color:#ffffff; font-family:'Outfit';">-</strong>
							</div>
						</div>
					</div>

					<h4 class="mb-3" style="font-size:0.9rem; letter-spacing:0.05em; text-transform:uppercase; color:var(--accent-cyan);">
						<?php esc_html_e( 'Relevance Sorted Context Chunks', 'chat-pilot' ); ?>
					</h4>
					<div class="search-results-list">
						<!-- Filled Dynamically -->
					</div>
				</div>
			</div>
		</div>
	</section>

</div>

<!-- Glassmorphic Document Preview Modal -->
<div id="cp-preview-modal" class="cp-modal-overlay" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(15,23,42,0.85); backdrop-filter:blur(8px); z-index:99999; align-items:center; justify-content:center; padding:2rem; box-sizing:border-box;">
	<div class="cp-modal-content" style="background:#0f172a; border:1px solid rgba(255,255,255,0.12); border-radius:16px; width:100%; max-width: 800px; max-height:85vh; display:flex; flex-direction:column; box-shadow:0 20px 50px rgba(0,0,0,0.5);">
		<div class="cp-modal-header" style="padding:1.5rem; border-bottom:1px solid rgba(255,255,255,0.08); display:flex; align-items:center; justify-content:space-between; box-sizing:border-box;">
			<h3 id="cp-preview-modal-title" style="margin:0; font-family:'Outfit'; color:#ffffff; font-size:1.3rem; word-break:break-all;">Page Preview</h3>
			<button type="button" id="cp-preview-modal-close" style="background:none; border:none; color:#94a3b8; font-size:1.75rem; cursor:pointer; line-height:1;">&times;</button>
		</div>
		<div id="cp-preview-modal-body" style="padding:2rem; overflow-y:auto; flex-grow:1; font-family: 'Fira Code', monospace; font-size:0.9rem; line-height:1.6; color:#e2e8f0; background:rgba(0,0,0,0.25); white-space:pre-wrap;">
		</div>
		<div class="cp-modal-footer" style="padding:1rem 1.5rem; border-top:1px solid rgba(255,255,255,0.08); text-align:right; box-sizing:border-box; display:flex; align-items:center; justify-content:space-between;">
			<span id="cp-preview-modal-url" style="font-size:0.8rem; color:var(--accent-cyan); word-break:break-all; max-width:70%; text-align:left;"></span>
			<button type="button" id="cp-preview-modal-close-btn" class="cp-btn cp-btn-secondary cp-btn-sm"><?php esc_html_e( 'Close Preview', 'chat-pilot' ); ?></button>
		</div>
	</div>
</div>
