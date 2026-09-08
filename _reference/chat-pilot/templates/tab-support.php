<?php
/**
 * Help & Support Center Interface Template.
 * Brand: Local Marketing Geeks
 */

// Prevent direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

global $wpdb;

$plugin           = \ChatPilot\Core\Plugin::instance();
$cp_version       = defined( 'CHAT_PILOT_VERSION' ) ? CHAT_PILOT_VERSION : '1.1.0-alpha';
$wp_version       = get_bloginfo( 'version' );
$php_version      = PHP_VERSION;
$db_version       = $wpdb->db_version();
$server_software  = isset( $_SERVER['SERVER_SOFTWARE'] ) ? sanitize_text_field( $_SERVER['SERVER_SOFTWARE'] ) : 'Unknown';

$sysinfo_formatted = "=== CHAT PILOT SYSTEM DIAGNOSTICS ===\n";
$sysinfo_formatted .= "Chat Pilot Version: {$cp_version}\n";
$sysinfo_formatted .= "WordPress Version: {$wp_version}\n";
$sysinfo_formatted .= "PHP Version: {$php_version}\n";
$sysinfo_formatted .= "Database Version: {$db_version}\n";
$sysinfo_formatted .= "Server Environment: {$server_software}\n";
$sysinfo_formatted .= "Multisite: " . ( is_multisite() ? 'Yes' : 'No' ) . "\n";
$sysinfo_formatted .= "Generated: " . current_time( 'mysql' ) . "\n";
?>

<div id="cp-support-center">
	<!-- 1. Header & Quick Search Bar -->
	<div class="cp-card" style="margin-bottom: 2rem; padding: 2.25rem 2rem; background: linear-gradient(135deg, rgba(11, 15, 25, 0.95), rgba(17, 24, 39, 0.8));">
		<div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1.5rem;">
			<div>
				<h2 style="font-family: 'Outfit', sans-serif; font-size: 1.85rem; font-weight: 800; margin: 0 0 0.5rem 0; color: #ffffff;">
					<?php esc_html_e( 'Help & Support Center', 'chat-pilot' ); ?>
				</h2>
				<p style="font-size: 0.95rem; color: var(--text-secondary); margin: 0; max-width: 650px; line-height: 1.6;">
					<?php esc_html_e( 'Comprehensive setup guides, architectural reference documentation, interactive troubleshooting, and support resources for Chat Pilot administrators.', 'chat-pilot' ); ?>
				</p>
			</div>
			
			<!-- Interactive Live Search -->
			<div style="position: relative; min-width: 320px; flex-grow: 1; max-width: 420px;">
				<input type="text" id="cp-support-search" class="cp-input-text" placeholder="<?php esc_attr_e( 'Search support guides (e.g. Gemini, FAQ, Tokens, Fallback)...', 'chat-pilot' ); ?>" style="padding-left: 2.5rem !important; height: 44px; font-size: 0.9rem;">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="position: absolute; left: 0.85rem; top: 50%; transform: translateY(-50%); width: 18px; height: 18px; color: var(--text-muted);"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
			</div>
		</div>
	</div>

	<!-- 2. Onboarding Workflow & Support Card Grid -->
	<div class="cp-dashboard-grid" style="grid-template-columns: 2fr 1fr; margin-bottom: 2rem; gap: 2rem;">
		<!-- Onboarding Recommended Setup Sequence -->
		<div class="cp-card">
			<h3 class="cp-card-title">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 11 12 14 22 4"></polyline><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg>
				<?php esc_html_e( 'Recommended Getting Started Sequence', 'chat-pilot' ); ?>
			</h3>
			<p style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 1.5rem;">
				<?php esc_html_e( 'Follow this 9-step configuration roadmap to set up, train, test, and deploy Chat Pilot on your WordPress website.', 'chat-pilot' ); ?>
			</p>

			<div style="display: flex; flex-direction: column; gap: 0.75rem;">
				<?php
				$onboarding_steps = array(
					1 => array(
						'title' => __( '1. Configure AI Provider', 'chat-pilot' ),
						'desc'  => __( 'Enter your API key under AI Providers, test the connection, and let dynamic discovery fetch valid models.', 'chat-pilot' ),
						'tab'   => 'providers',
					),
					2 => array(
						'title' => __( '2. Add Knowledge Base Content', 'chat-pilot' ),
						'desc'  => __( 'Ingest business information using Website Crawler, Manual Knowledge, Document Uploads, or FAQ Manager.', 'chat-pilot' ),
						'tab'   => 'kb',
					),
					3 => array(
						'title' => __( '3. Configure AI Instructions', 'chat-pilot' ),
						'desc'  => __( 'Set business directives, tone guidelines, hallucination boundaries, and missing knowledge fallback responses.', 'chat-pilot' ),
						'tab'   => 'instructions',
					),
					4 => array(
						'title' => __( '4. Test in Developer Chat Preview', 'chat-pilot' ),
						'desc'  => __( 'Verify knowledge retrieval, confidence scoring, and model responses in our internal testing sandbox.', 'chat-pilot' ),
						'tab'   => 'playground',
					),
					5 => array(
						'title' => __( '5. Configure Chat Widget', 'chat-pilot' ),
						'desc'  => __( 'Customize widget appearance, colors, position, greeting, suggested questions, and streaming behavior.', 'chat-pilot' ),
						'tab'   => 'widget',
					),
					6 => array(
						'title' => __( '6. Configure Lead Forms', 'chat-pilot' ),
						'desc'  => __( 'Build pre-chat lead capture forms with custom data fields to collect visitor names, emails, and phone numbers.', 'chat-pilot' ),
						'tab'   => 'forms',
					),
					7 => array(
						'title' => __( '7. Review Conversations', 'chat-pilot' ),
						'desc'  => __( 'Monitor active visitor sessions, inspect full transcripts, review lead details, and track conversation lifecycle.', 'chat-pilot' ),
						'tab'   => 'conversations',
					),
					8 => array(
						'title' => __( '8. Review Analytics & Costs', 'chat-pilot' ),
						'desc'  => __( 'Track total conversations, token usage, estimated AI API cost, and knowledge retrieval success rates.', 'chat-pilot' ),
						'tab'   => 'analytics',
					),
					9 => array(
						'title' => __( '9. Deploy Chat Pilot Live', 'chat-pilot' ),
						'desc'  => __( 'Enable the frontend widget under Settings or Chat Widget to launch your AI assistant live for visitors.', 'chat-pilot' ),
						'tab'   => 'settings',
					),
				);

				foreach ( $onboarding_steps as $step_num => $step ) :
					$tab_url = add_query_arg( array( 'page' => 'chat-pilot', 'tab' => $step['tab'] ), admin_url( 'admin.php' ) );
					?>
					<div class="cp-support-searchable" style="background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.05); border-radius: 8px; padding: 1rem 1.25rem; display: flex; align-items: center; justify-content: space-between; gap: 1rem;">
						<div>
							<h4 style="font-family: 'Outfit', sans-serif; font-size: 0.95rem; font-weight: 700; margin: 0 0 0.25rem 0; color: #ffffff;">
								<?php echo esc_html( $step['title'] ); ?>
							</h4>
							<p style="font-size: 0.8rem; color: var(--text-secondary); margin: 0;">
								<?php echo esc_html( $step['desc'] ); ?>
							</p>
						</div>
						<a href="<?php echo esc_url( $tab_url ); ?>" class="cp-btn cp-btn-secondary" style="font-size: 0.75rem; padding: 0.4rem 0.85rem; flex-shrink: 0; text-decoration: none;">
							<?php esc_html_e( 'Open Tab', 'chat-pilot' ); ?>
						</a>
					</div>
				<?php endforeach; ?>
			</div>
		</div>

		<!-- Sidebar: Local Marketing Geeks Support & System Info -->
		<div style="display: flex; flex-direction: column; gap: 2rem;">
			<!-- Local Marketing Geeks Support Card -->
			<div class="cp-card">
				<h3 class="cp-card-title">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
					<?php esc_html_e( 'Need Help?', 'chat-pilot' ); ?>
				</h3>
				<p style="font-size: 0.85rem; color: var(--text-secondary); line-height: 1.6; margin-bottom: 1.25rem;">
					<?php esc_html_e( 'Chat Pilot is developed and supported by Local Marketing Geeks. Reach out directly to our technical team for assistance, issue reports, or feedback.', 'chat-pilot' ); ?>
				</p>

				<!-- Direct In-Plugin Contact Details Box -->
				<div style="background: rgba(6, 182, 212, 0.05); border: 1px solid rgba(6, 182, 212, 0.2); border-radius: 8px; padding: 0.85rem 1rem; margin-bottom: 1.25rem; display: flex; flex-direction: column; gap: 0.5rem;">
					<div style="display: flex; align-items: center; justify-content: space-between; font-size: 0.85rem;">
						<span style="color: var(--text-secondary); display: flex; align-items: center; gap: 0.4rem;">
							<span>📞</span> <strong>Phone:</strong>
						</span>
						<a href="tel:8882992726" style="color: var(--accent-cyan); font-family: var(--font-mono); font-weight: 700; text-decoration: none;">
							888-299-2726
						</a>
					</div>
					<div style="display: flex; align-items: center; justify-content: space-between; font-size: 0.85rem;">
						<span style="color: var(--text-secondary); display: flex; align-items: center; gap: 0.4rem;">
							<span>✉️</span> <strong>Email:</strong>
						</span>
						<a href="mailto:info@localmarketinggeeks.com" style="color: var(--accent-cyan); font-family: var(--font-mono); font-weight: 700; text-decoration: none;">
							info@localmarketinggeeks.com
						</a>
					</div>
				</div>

				<!-- In-Plugin Action Buttons (No External Website Redirects) -->
				<div style="display: flex; flex-direction: column; gap: 0.65rem;">
					<button type="button" id="cp-btn-doc-scroll" class="cp-btn cp-btn-secondary" style="justify-content: flex-start; gap: 0.75rem; font-size: 0.85rem; width: 100%;">
						<span style="font-size: 1rem;">📖</span> <?php esc_html_e( 'Official Documentation', 'chat-pilot' ); ?>
					</button>
					<button type="button" id="cp-btn-contact-support" class="cp-btn cp-btn-secondary" style="justify-content: flex-start; gap: 0.75rem; font-size: 0.85rem; width: 100%;">
						<span style="font-size: 1rem;">💬</span> <?php esc_html_e( 'Contact Technical Support', 'chat-pilot' ); ?>
					</button>
					<button type="button" id="cp-btn-report-issue" class="cp-btn cp-btn-secondary" style="justify-content: flex-start; gap: 0.75rem; font-size: 0.85rem; width: 100%;">
						<span style="font-size: 1rem;">🐛</span> <?php esc_html_e( 'Report an Issue', 'chat-pilot' ); ?>
					</button>
					<a href="mailto:info@localmarketinggeeks.com?subject=Chat%20Pilot%20Product%20Feedback" id="cp-btn-submit-feedback" class="cp-btn cp-btn-secondary" style="justify-content: flex-start; gap: 0.75rem; text-decoration: none; font-size: 0.85rem; width: 100%;">
						<span style="font-size: 1rem;">💡</span> <?php esc_html_e( 'Submit Product Feedback', 'chat-pilot' ); ?>
					</a>
				</div>
			</div>

			<!-- System Information Environment Diagnostics -->
			<div class="cp-card">
				<h3 class="cp-card-title">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>
					<?php esc_html_e( 'System Environment Info', 'chat-pilot' ); ?>
				</h3>
				<ul class="cp-info-list" style="font-size: 0.8rem; margin-bottom: 1.25rem;">
					<li class="cp-info-row">
						<span class="cp-info-label"><?php esc_html_e( 'Chat Pilot Version', 'chat-pilot' ); ?></span>
						<span class="cp-info-value" style="font-family: var(--font-mono); color: var(--accent-cyan);"><?php echo esc_html( $cp_version ); ?></span>
					</li>
					<li class="cp-info-row">
						<span class="cp-info-label"><?php esc_html_e( 'WordPress Version', 'chat-pilot' ); ?></span>
						<span class="cp-info-value" style="font-family: var(--font-mono);"><?php echo esc_html( $wp_version ); ?></span>
					</li>
					<li class="cp-info-row">
						<span class="cp-info-label"><?php esc_html_e( 'PHP Version', 'chat-pilot' ); ?></span>
						<span class="cp-info-value" style="font-family: var(--font-mono);"><?php echo esc_html( $php_version ); ?></span>
					</li>
					<li class="cp-info-row">
						<span class="cp-info-label"><?php esc_html_e( 'Database Engine', 'chat-pilot' ); ?></span>
						<span class="cp-info-value" style="font-family: var(--font-mono);"><?php echo esc_html( $db_version ); ?></span>
					</li>
				</ul>

				<button type="button" id="cp-copy-sysinfo" class="cp-btn cp-btn-primary" style="width: 100%; justify-content: center;" data-sysinfo="<?php echo esc_attr( $sysinfo_formatted ); ?>">
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
					<?php esc_html_e( 'Copy System Info', 'chat-pilot' ); ?>
				</button>
			</div>
		</div>
	</div>

	<!-- 3. Expandable Documentation Accordion Sections -->
	<div class="cp-card">
		<h3 id="cp-module-docs-title" class="cp-card-title">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>
			<?php esc_html_e( 'Module Documentation & Reference Guides', 'chat-pilot' ); ?>
		</h3>

		<div class="cp-accordion-wrapper" style="display: flex; flex-direction: column; gap: 1rem;">

			<!-- 1. AI Providers Help -->
			<div class="cp-accordion-item cp-support-searchable" style="background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 8px; overflow: hidden;">
				<button type="button" class="cp-accordion-header" style="width: 100%; text-align: left; padding: 1.25rem 1.5rem; background: none; border: none; color: #ffffff; font-family: 'Outfit', sans-serif; font-size: 1.05rem; font-weight: 700; display: flex; justify-content: space-between; align-items: center; cursor: pointer;">
					<span>⚡ AI Providers Architecture & Model Discovery</span>
					<span class="cp-accordion-icon" style="transition: transform 0.2s ease;">▼</span>
				</button>
				<div class="cp-accordion-body" style="display: none; padding: 0 1.5rem 1.5rem 1.5rem; border-top: 1px solid rgba(255, 255, 255, 0.05); color: var(--text-secondary); font-size: 0.9rem; line-height: 1.6;">
					<p style="margin-top: 1rem;"><strong>Single Source of Truth:</strong> The <strong>AI Providers</strong> tab is the authoritative configuration engine for LLM driver credentials, connection testing, health monitoring, and active provider selection.</p>
					<ul style="padding-left: 1.25rem; margin: 0.75rem 0;">
						<li><strong>API Credentials Key:</strong> Enter your secret API key (e.g. OpenAI <code>sk-proj-...</code> or Google AI Studio <code>AIzaSy...</code>). Keys are encrypted and masked upon saving.</li>
						<li><strong>Dynamic Model Discovery:</strong> Clicking <em>Test Connection</em> queries the remote provider API live using your API key. Returned chat models populate the <em>Preferred Model Default</em> dropdown. Hardcoded model lists do not exist.</li>
						<li><strong>Lifecycle Status Badges:</strong>
							<ul>
								<li><code>Not Configured</code>: No API key entered.</li>
								<li><code>Not Yet Verified</code>: API key entered, but connection test not yet executed.</li>
								<li><code>Connected</code>: Connection test passed and provider enabled.</li>
								<li><code>Connection Failed</code> / <code>Authentication Failed</code>: API rejected credentials or request timed out.</li>
							</ul>
						</li>
					</ul>
				</div>
			</div>

			<!-- 2. Knowledge Base Help -->
			<div class="cp-accordion-item cp-support-searchable" style="background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 8px; overflow: hidden;">
				<button type="button" class="cp-accordion-header" style="width: 100%; text-align: left; padding: 1.25rem 1.5rem; background: none; border: none; color: #ffffff; font-family: 'Outfit', sans-serif; font-size: 1.05rem; font-weight: 700; display: flex; justify-content: space-between; align-items: center; cursor: pointer;">
					<span>📚 Knowledge Base Ingestion & Retrieval Pipeline</span>
					<span class="cp-accordion-icon" style="transition: transform 0.2s ease;">▼</span>
				</button>
				<div class="cp-accordion-body" style="display: none; padding: 0 1.5rem 1.5rem 1.5rem; border-top: 1px solid rgba(255, 255, 255, 0.05); color: var(--text-secondary); font-size: 0.9rem; line-height: 1.6;">
					<p style="margin-top: 1rem;"><strong>Four Ingestion Methods:</strong></p>
					<ol style="padding-left: 1.25rem; margin: 0.75rem 0;">
						<li><strong>Website URL Crawler:</strong> Recursively scans website pages and indexes clean text.</li>
						<li><strong>Manual Business Entry:</strong> Directly write custom corporate policies, pricing structures, or service guidelines.</li>
						<li><strong>Local Document Uploader:</strong> Upload text/PDF files for automatic chunking and indexing.</li>
						<li><strong>FAQ Q&A Builder:</strong> Import bulk Q&A pairs or enter individual high-priority questions and answers.</li>
					</ol>
					<p><strong>Authoritative Source Retrieval Priority:</strong></p>
					<div style="background: rgba(6, 182, 212, 0.08); border: 1px solid rgba(6, 182, 212, 0.2); border-radius: 6px; padding: 0.75rem 1rem; color: var(--accent-cyan); font-weight: 600; font-size: 0.85rem; margin: 0.5rem 0 1rem 0;">
						FAQ Manager → Manual Knowledge → Uploaded Documents → Website Content
					</div>
					<p>When a visitor asks a question, Chat Pilot searches the index according to this exact priority sequence. High-priority FAQ answers override generic website text.</p>
				</div>
			</div>

			<!-- 3. AI Instructions Help -->
			<div class="cp-accordion-item cp-support-searchable" style="background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 8px; overflow: hidden;">
				<button type="button" class="cp-accordion-header" style="width: 100%; text-align: left; padding: 1.25rem 1.5rem; background: none; border: none; color: #ffffff; font-family: 'Outfit', sans-serif; font-size: 1.05rem; font-weight: 700; display: flex; justify-content: space-between; align-items: center; cursor: pointer;">
					<span>🎯 AI Instructions, Directives & Fallback Control</span>
					<span class="cp-accordion-icon" style="transition: transform 0.2s ease;">▼</span>
				</button>
				<div class="cp-accordion-body" style="display: none; padding: 0 1.5rem 1.5rem 1.5rem; border-top: 1px solid rgba(255, 255, 255, 0.05); color: var(--text-secondary); font-size: 0.9rem; line-height: 1.6;">
					<p style="margin-top: 1rem;"><strong>Core Relationship Distinction:</strong></p>
					<ul style="padding-left: 1.25rem; margin: 0.75rem 0;">
						<li><strong>Knowledge Base:</strong> Controls <em>WHAT</em> the AI assistant knows (factual domain facts).</li>
						<li><strong>AI Instructions:</strong> Controls <em>HOW</em> the AI assistant behaves (tone, rules, boundaries, and brevity).</li>
					</ul>
					<p><strong>Missing Knowledge Fallback Response:</strong></p>
					<p>This setting under AI Instructions specifies the exact polite response given to visitors when no relevant knowledge base match meets the required confidence score threshold. (e.g. <em>"I couldn't find information about that in our knowledge base."</em>).</p>
				</div>
			</div>

			<!-- 4. Developer Chat Preview Help -->
			<div class="cp-accordion-item cp-support-searchable" style="background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 8px; overflow: hidden;">
				<button type="button" class="cp-accordion-header" style="width: 100%; text-align: left; padding: 1.25rem 1.5rem; background: none; border: none; color: #ffffff; font-family: 'Outfit', sans-serif; font-size: 1.05rem; font-weight: 700; display: flex; justify-content: space-between; align-items: center; cursor: pointer;">
					<span>🧪 Developer Chat Preview Internal Sandbox</span>
					<span class="cp-accordion-icon" style="transition: transform 0.2s ease;">▼</span>
				</button>
				<div class="cp-accordion-body" style="display: none; padding: 0 1.5rem 1.5rem 1.5rem; border-top: 1px solid rgba(255, 255, 255, 0.05); color: var(--text-secondary); font-size: 0.9rem; line-height: 1.6;">
					<p style="margin-top: 1rem;">The <strong>Developer Chat Preview</strong> is an internal administrative sandbox that executes queries through the exact same 5-stage pipeline as the frontend visitor widget:</p>
					<div style="font-family: var(--font-mono); font-size: 0.8rem; background: #0f172a; padding: 0.75rem 1rem; border-radius: 6px; color: var(--accent-cyan); margin: 0.5rem 0;">
						User Question → Knowledge Retrieval → Source Priority → System Instructions → AI Provider → Response
					</div>
					<p><strong>Developer Mode Diagnostics:</strong> In preview mode, administrators can inspect retrieval scores, matched source chunks, token usage breakdown, and API latency. These diagnostic details are strictly hidden from public visitors.</p>
				</div>
			</div>

			<!-- 5. Chat Widget Help -->
			<div class="cp-accordion-item cp-support-searchable" style="background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 8px; overflow: hidden;">
				<button type="button" class="cp-accordion-header" style="width: 100%; text-align: left; padding: 1.25rem 1.5rem; background: none; border: none; color: #ffffff; font-family: 'Outfit', sans-serif; font-size: 1.05rem; font-weight: 700; display: flex; justify-content: space-between; align-items: center; cursor: pointer;">
					<span>💬 Chat Widget Customization & Visitor UX</span>
					<span class="cp-accordion-icon" style="transition: transform 0.2s ease;">▼</span>
				</button>
				<div class="cp-accordion-body" style="display: none; padding: 0 1.5rem 1.5rem 1.5rem; border-top: 1px solid rgba(255, 255, 255, 0.05); color: var(--text-secondary); font-size: 0.9rem; line-height: 1.6;">
					<p style="margin-top: 1rem;">Configure your public floating chatbot under <strong>Chat Widget</strong>:</p>
					<ul style="padding-left: 1.25rem; margin: 0.75rem 0;">
						<li><strong>Widget Position & Styling:</strong> Choose Bottom-Right or Bottom-Left alignment and select brand colors.</li>
						<li><strong>Auto-Open & Behavior:</strong> Enable automatic trigger delays and set "Open once per visitor" cookies.</li>
						<li><strong>Suggested Questions:</strong> Add pre-set prompt chips for quick visitor clicks.</li>
						<li><strong>Typing Indicator & Real-Time Streaming:</strong> Enable character-by-character typewriter streaming for natural AI conversation flow.</li>
					</ul>
				</div>
			</div>

			<!-- 6. Forms & Leads Help -->
			<div class="cp-accordion-item cp-support-searchable" style="background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 8px; overflow: hidden;">
				<button type="button" class="cp-accordion-header" style="width: 100%; text-align: left; padding: 1.25rem 1.5rem; background: none; border: none; color: #ffffff; font-family: 'Outfit', sans-serif; font-size: 1.05rem; font-weight: 700; display: flex; justify-content: space-between; align-items: center; cursor: pointer;">
					<span>📋 Forms & Lead Generation Architecture</span>
					<span class="cp-accordion-icon" style="transition: transform 0.2s ease;">▼</span>
				</button>
				<div class="cp-accordion-body" style="display: none; padding: 0 1.5rem 1.5rem 1.5rem; border-top: 1px solid rgba(255, 255, 255, 0.05); color: var(--text-secondary); font-size: 0.9rem; line-height: 1.6;">
					<p style="margin-top: 1rem;"><strong>Lead Capture Data Pipeline:</strong></p>
					<div style="font-family: var(--font-mono); font-size: 0.8rem; background: #0f172a; padding: 0.75rem 1rem; border-radius: 6px; color: var(--accent-green); margin: 0.5rem 0;">
						Form Builder → Visitor Submission → Conversation Session → Submission Record
					</div>
					<p>Visitors submit pre-chat forms before opening chat sessions. Submissions bind visitor name, email, phone, and custom fields directly to the resulting conversation transcript.</p>
				</div>
			</div>

			<!-- 7. Conversations Help -->
			<div class="cp-accordion-item cp-support-searchable" style="background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 8px; overflow: hidden;">
				<button type="button" class="cp-accordion-header" style="width: 100%; text-align: left; padding: 1.25rem 1.5rem; background: none; border: none; color: #ffffff; font-family: 'Outfit', sans-serif; font-size: 1.05rem; font-weight: 700; display: flex; justify-content: space-between; align-items: center; cursor: pointer;">
					<span>💬 Conversations Management & Session Lifecycle</span>
					<span class="cp-accordion-icon" style="transition: transform 0.2s ease;">▼</span>
				</button>
				<div class="cp-accordion-body" style="display: none; padding: 0 1.5rem 1.5rem 1.5rem; border-top: 1px solid rgba(255, 255, 255, 0.05); color: var(--text-secondary); font-size: 0.9rem; line-height: 1.6;">
					<p style="margin-top: 1rem;"><strong>Session Filtering & Search:</strong> Inspect visitor sessions filtered by status (Active, Completed, Unread), source (Developer Preview vs Widget), linked form, or keyword search.</p>
					<p><strong>Session Inactivity Timeout:</strong> Sessions automatically transition from Active to Completed after the configured inactivity timeout (default: 30 minutes).</p>
				</div>
			</div>

			<!-- 8. Analytics Help -->
			<div class="cp-accordion-item cp-support-searchable" style="background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 8px; overflow: hidden;">
				<button type="button" class="cp-accordion-header" style="width: 100%; text-align: left; padding: 1.25rem 1.5rem; background: none; border: none; color: #ffffff; font-family: 'Outfit', sans-serif; font-size: 1.05rem; font-weight: 700; display: flex; justify-content: space-between; align-items: center; cursor: pointer;">
					<span>📊 Analytics & Token Usage Cost Estimation</span>
					<span class="cp-accordion-icon" style="transition: transform 0.2s ease;">▼</span>
				</button>
				<div class="cp-accordion-body" style="display: none; padding: 0 1.5rem 1.5rem 1.5rem; border-top: 1px solid rgba(255, 255, 255, 0.05); color: var(--text-secondary); font-size: 0.9rem; line-height: 1.6;">
					<p style="margin-top: 1rem;"><strong>Token & Cost Calculation Metrics:</strong></p>
					<ul style="padding-left: 1.25rem; margin: 0.75rem 0;">
						<li><strong>Input / Output / Total Tokens:</strong> Tracks exact API token consumption for prompts and completions.</li>
						<li><strong>Estimated AI Cost:</strong> Calculated locally using official provider per-token rates (e.g. Gemini 1.5 Flash at $0.000075 / 1k input tokens).</li>
						<li><strong>Important Note:</strong> Chat Pilot's estimated cost calculations are local approximations and do not modify external provider billing accounts.</li>
					</ul>
				</div>
			</div>

			<!-- 9. Settings Help -->
			<div class="cp-accordion-item cp-support-searchable" style="background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 8px; overflow: hidden;">
				<button type="button" class="cp-accordion-header" style="width: 100%; text-align: left; padding: 1.25rem 1.5rem; background: none; border: none; color: #ffffff; font-family: 'Outfit', sans-serif; font-size: 1.05rem; font-weight: 700; display: flex; justify-content: space-between; align-items: center; cursor: pointer;">
					<span>⚙️ Global Settings Center</span>
					<span class="cp-accordion-icon" style="transition: transform 0.2s ease;">▼</span>
				</button>
				<div class="cp-accordion-body" style="display: none; padding: 0 1.5rem 1.5rem 1.5rem; border-top: 1px solid rgba(255, 255, 255, 0.05); color: var(--text-secondary); font-size: 0.9rem; line-height: 1.6;">
					<p style="margin-top: 1rem;">Settings manages global operational rules across 8 clean sections: General, Conversations, Privacy & Data, Notifications, Performance, Security, Developer Mode, and Maintenance.</p>
					<p><em>Provider configuration and model selection belong exclusively under AI Providers.</em></p>
				</div>
			</div>

			<!-- 10. Troubleshooting Center -->
			<div class="cp-accordion-item cp-support-searchable" style="background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 8px; overflow: hidden;">
				<button type="button" class="cp-accordion-header" style="width: 100%; text-align: left; padding: 1.25rem 1.5rem; background: rgba(239, 68, 68, 0.04); border: none; color: #ffffff; font-family: 'Outfit', sans-serif; font-size: 1.05rem; font-weight: 700; display: flex; justify-content: space-between; align-items: center; cursor: pointer;">
					<span>🛠️ Troubleshooting Center (Common Scenarios)</span>
					<span class="cp-accordion-icon" style="transition: transform 0.2s ease;">▼</span>
				</button>
				<div class="cp-accordion-body" style="display: none; padding: 1.5rem; border-top: 1px solid rgba(239, 68, 68, 0.15); color: var(--text-secondary); font-size: 0.9rem; line-height: 1.6;">
					
					<div style="margin-bottom: 1.25rem;">
						<h5 style="color: var(--accent-cyan); font-size: 0.95rem; margin: 0 0 0.25rem 0;">1. AI Provider Not Connecting / Showing "Connection Failed"</h5>
						<p style="margin: 0;">Verify API key formatting without leading/trailing spaces. Click <em>Test Connection</em> in AI Providers to inspect latency and specific HTTP error codes (e.g. 401 Unauthorized or 429 Rate Limited).</p>
					</div>

					<div style="margin-bottom: 1.25rem;">
						<h5 style="color: var(--accent-cyan); font-size: 0.95rem; margin: 0 0 0.25rem 0;">2. Chatbot Returning Fallback Unexpectedly</h5>
						<p style="margin: 0;">Check Knowledge Base ingestion status. Use Developer Chat Preview to inspect exact similarity scores against your knowledge sources and lower confidence thresholds if necessary under Settings.</p>
					</div>

					<div style="margin-bottom: 1.25rem;">
						<h5 style="color: var(--accent-cyan); font-size: 0.95rem; margin: 0 0 0.25rem 0;">3. Lead Form Not Appearing in Chat Widget</h5>
						<p style="margin: 0;">Verify that your active form has fields enabled under <strong>Forms</strong> and that "Require Form Before Chat" is checked in widget settings.</p>
					</div>

					<div style="margin-bottom: 1.25rem;">
						<h5 style="color: var(--accent-cyan); font-size: 0.95rem; margin: 0 0 0.25rem 0;">4. Old or Stale Model Still Appearing</h5>
						<p style="margin: 0;">Go to AI Providers, run <em>Test Connection</em> to execute dynamic model discovery, select a newly discovered model, and save changes.</p>
					</div>

					<div>
						<h5 style="color: var(--accent-cyan); font-size: 0.95rem; margin: 0 0 0.25rem 0;">5. Floating Chat Widget Not Appearing on Frontend</h5>
						<p style="margin: 0;">Check that <em>Enable Plugin</em> is checked under Settings → General and <em>Enable Chat Widget</em> is checked under Chat Widget settings.</p>
					</div>

				</div>
			</div>

		</div>
	</div>
</div>

<script type="text/javascript">
	document.addEventListener('DOMContentLoaded', function() {
		// 1. Accordion Toggle Interactivity
		const accordionHeaders = document.querySelectorAll('.cp-accordion-header');
		accordionHeaders.forEach(function(header) {
			header.addEventListener('click', function() {
				const item = this.parentElement;
				const body = item.querySelector('.cp-accordion-body');
				const icon = this.querySelector('.cp-accordion-icon');
				
				const isOpen = body.style.display === 'block';
				
				if (isOpen) {
					body.style.display = 'none';
					icon.style.transform = 'rotate(0deg)';
				} else {
					body.style.display = 'block';
					icon.style.transform = 'rotate(180deg)';
				}
			});
		});

		// 2. Real-time Search Filtering
		const searchInput = document.getElementById('cp-support-search');
		if (searchInput) {
			searchInput.addEventListener('input', function() {
				const query = this.value.toLowerCase().trim();
				const searchableItems = document.querySelectorAll('.cp-support-searchable');
				
				searchableItems.forEach(function(item) {
					const text = item.textContent.toLowerCase();
					if (!query || text.indexOf(query) !== -1) {
						item.style.display = '';
						// If matching an accordion item while searching, auto-expand it
						if (query && item.classList.contains('cp-accordion-item')) {
							const body = item.querySelector('.cp-accordion-body');
							const icon = item.querySelector('.cp-accordion-icon');
							if (body) {
								body.style.display = 'block';
								if (icon) icon.style.transform = 'rotate(180deg)';
							}
						}
					} else {
						item.style.display = 'none';
					}
				});
			});
		}

		// 3. Copy System Info Helper
		const copyBtn = document.getElementById('cp-copy-sysinfo');
		if (copyBtn) {
			copyBtn.addEventListener('click', function() {
				const textToCopy = this.getAttribute('data-sysinfo');
				if (navigator.clipboard && window.isSecureContext) {
					navigator.clipboard.writeText(textToCopy).then(function() {
						alert('System Info copied to clipboard!');
					});
				} else {
					const textArea = document.createElement('textarea');
					textArea.value = textToCopy;
					document.body.appendChild(textArea);
					textArea.select();
					try {
						document.execCommand('copy');
						alert('System Info copied to clipboard!');
					} catch (err) {
						alert('Copy failed. Please copy text manually.');
					}
					document.body.removeChild(textArea);
				}
			});
		}

		// 4. In-Plugin Support Action Buttons (Zero External Redirects)
		const docBtn = document.getElementById('cp-btn-doc-scroll');
		if (docBtn) {
			docBtn.addEventListener('click', function() {
				const docsHeading = document.getElementById('cp-module-docs-title');
				if (docsHeading) {
					docsHeading.scrollIntoView({ behavior: 'smooth' });
					// Expand all accordions so documentation is immediately visible
					document.querySelectorAll('.cp-accordion-body').forEach(function(b) { b.style.display = 'block'; });
					document.querySelectorAll('.cp-accordion-icon').forEach(function(i) { i.style.transform = 'rotate(180deg)'; });
				}
			});
		}

		const supportModal = document.getElementById('cp-support-contact-modal');
		const modalTitle = document.getElementById('cp-support-modal-title');
		const modalSub = document.getElementById('cp-support-modal-sub');
		const modalMailBtn = document.getElementById('cp-support-modal-email-btn');

		const contactSupportBtn = document.getElementById('cp-btn-contact-support');
		if (contactSupportBtn) {
			contactSupportBtn.addEventListener('click', function() {
				if (modalTitle) modalTitle.textContent = 'Contact Local Marketing Geeks Support';
				if (modalSub) modalSub.textContent = 'Reach out directly via phone or email for technical assistance with Chat Pilot.';
				if (modalMailBtn) modalMailBtn.href = 'mailto:info@localmarketinggeeks.com?subject=Chat%20Pilot%20Technical%20Support%20Request';
				if (supportModal) supportModal.style.display = 'flex';
			});
		}

		const reportIssueBtn = document.getElementById('cp-btn-report-issue');
		if (reportIssueBtn) {
			reportIssueBtn.addEventListener('click', function() {
				if (modalTitle) modalTitle.textContent = 'Report an Issue to Local Marketing Geeks';
				if (modalSub) modalSub.textContent = 'Report bugs or unexpected behavior. Use the button below to email our development team directly.';
				if (modalMailBtn) modalMailBtn.href = 'mailto:info@localmarketinggeeks.com?subject=Chat%20Pilot%20Issue%20Report';
				if (supportModal) supportModal.style.display = 'flex';
			});
		}

		const modalCloseBtn = document.getElementById('cp-support-modal-close');
		if (modalCloseBtn) {
			modalCloseBtn.addEventListener('click', function() {
				if (supportModal) supportModal.style.display = 'none';
			});
		}
	});
</script>

<!-- Modal Container for In-Plugin Support Interactions -->
<div id="cp-support-contact-modal" style="display: none; position: fixed; inset: 0; background: rgba(0, 0, 0, 0.75); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); z-index: 999999; align-items: center; justify-content: center; padding: 1.5rem;">
	<div style="background: #0f172a; border: 1px solid var(--border-glow); border-radius: 12px; max-width: 500px; width: 100%; padding: 2rem; box-shadow: 0 20px 50px rgba(0,0,0,0.5); position: relative;">
		<button type="button" id="cp-support-modal-close" style="position: absolute; top: 1.25rem; right: 1.25rem; background: none; border: none; color: var(--text-muted); font-size: 1.25rem; cursor: pointer;">✕</button>
		
		<h3 id="cp-support-modal-title" style="font-family: 'Outfit', sans-serif; font-size: 1.35rem; font-weight: 700; color: #ffffff; margin: 0 0 0.5rem 0;">
			Contact Support
		</h3>
		<p id="cp-support-modal-sub" style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 1.5rem; line-height: 1.5;">
			Local Marketing Geeks support team contact details.
		</p>

		<!-- Direct Contact Info Display -->
		<div style="background: rgba(6, 182, 212, 0.05); border: 1px solid rgba(6, 182, 212, 0.2); border-radius: 8px; padding: 1rem; margin-bottom: 1.5rem; display: flex; flex-direction: column; gap: 0.75rem;">
			<div style="display: flex; align-items: center; justify-content: space-between;">
				<span style="font-size: 0.9rem; color: var(--text-secondary);">📞 <strong>Phone:</strong></span>
				<a href="tel:8882992726" style="font-family: var(--font-mono); font-weight: 700; color: var(--accent-cyan); font-size: 1rem; text-decoration: none;">
					888-299-2726
				</a>
			</div>
			<div style="display: flex; align-items: center; justify-content: space-between;">
				<span style="font-size: 0.9rem; color: var(--text-secondary);">✉️ <strong>Email:</strong></span>
				<a href="mailto:info@localmarketinggeeks.com" style="font-family: var(--font-mono); font-weight: 700; color: var(--accent-cyan); font-size: 0.9rem; text-decoration: none;">
					info@localmarketinggeeks.com
				</a>
			</div>
		</div>

		<div style="display: flex; gap: 1rem; flex-wrap: wrap;">
			<a id="cp-support-modal-email-btn" href="mailto:info@localmarketinggeeks.com" class="cp-btn cp-btn-primary" style="flex: 1; justify-content: center; text-decoration: none;">
				✉️ Send Email
			</a>
			<a href="tel:8882992726" class="cp-btn cp-btn-secondary" style="flex: 1; justify-content: center; text-decoration: none;">
				📞 Call Support
			</a>
		</div>
	</div>
</div>
