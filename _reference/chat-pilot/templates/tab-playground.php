<?php
/**
 * Tab Developer Chat Preview (Playground) view template.
 */

// Prevent direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$plugin = \ChatPilot\Core\Plugin::instance();
$fallback_msg = $plugin->settings->get( 'ai_instructions.fallback_response', "I couldn't find information about that. Please contact our team for additional assistance." );
$welcome_msg = $plugin->settings->get( 'widget.welcome_message', 'Hi there! How can I help you today?' );
$placeholder = $plugin->settings->get( 'widget.placeholder_text', 'Ask a question...' );
?>

<div class="cp-card" style="margin-bottom:1.5rem; padding: 1.25rem 1.5rem; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:1rem;">
	<div>
		<h2 style="font-family:'Outfit', sans-serif; font-size:1.4rem; font-weight:800; margin:0; background:linear-gradient(135deg, var(--accent-purple), var(--accent-cyan)); -webkit-background-clip:text; -webkit-text-fill-color:transparent; display:flex; align-items:center; gap:0.5rem;">
			💬 <?php esc_html_e( 'Developer Chat Preview', 'chat-pilot' ); ?>
		</h2>
		<p style="font-size:0.85rem; color:var(--text-secondary); margin:0.25rem 0 0 0;">
			<?php esc_html_e( 'Test the retrieval engine, custom directives, and provider settings inside the official visitor-matching RAG testing suite.', 'chat-pilot' ); ?>
		</p>
	</div>
	
	<div style="display:flex; align-items:center; gap:1rem; flex-wrap:wrap;">
		<?php
		$form_mgr  = new \ChatPilot\Forms\FormManager();
		$all_forms = $form_mgr->get_forms();
		?>
		<!-- Form Selector for Developer Chat Preview -->
		<div style="display:flex; align-items:center; gap:0.5rem; background:rgba(15,23,42,0.6); border:1px solid rgba(255,255,255,0.08); padding:0.4rem 0.85rem; border-radius:8px;">
			<label for="cp-play-form-selector" style="font-size:0.8rem; font-weight:700; color:#cbd5e1; white-space:nowrap;">📋 <?php esc_html_e( 'Test Form:', 'chat-pilot' ); ?></label>
			<select id="cp-play-form-selector" class="cp-input" style="height:32px; font-size:0.8rem; padding:0 0.5rem; color:#ffffff !important; -webkit-text-fill-color:#ffffff !important; background-color:#1e293b !important; color-scheme:dark !important; max-width:200px;">
				<?php foreach ( $all_forms as $af ) : ?>
					<option value="<?php echo esc_attr( $af['id'] ); ?>" <?php selected( $af['is_default'], 1 ); ?>>
						<?php echo esc_html( $af['name'] ); ?> <?php echo $af['is_default'] ? '(Default)' : ''; ?>
					</option>
				<?php endforeach; ?>
			</select>
		</div>

		<!-- Export Debug Log -->
		<button type="button" id="cp-play-export-log" class="cp-btn cp-btn-secondary" style="margin:0; font-size:0.85rem; padding:0.55rem 1rem; border-radius:8px;">
			📥 <?php esc_html_e( 'Export Debug Log', 'chat-pilot' ); ?>
		</button>
		
		<!-- Collapsible Developer Mode toggle -->
		<label class="cp-checkbox-label" style="background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.08); padding:0.6rem 1rem; border-radius:8px; display:inline-flex; align-items:center; cursor:pointer;">
			<input type="checkbox" id="cp-playground-dev-mode" class="cp-checkbox" value="1" checked>
			<span style="font-weight:700; font-size:0.85rem; color:#ffffff; margin-left:0.5rem;"><?php esc_html_e( 'Enable Debug Mode', 'chat-pilot' ); ?></span>
		</label>
	</div>
</div>

<div class="cp-dashboard-grid cp-playground-container" style="display:grid; grid-template-columns: 1fr 360px; gap:1.5rem; transition: all 0.3s ease;">
	<!-- Left main chat window -->
	<div class="cp-grid-main" style="display:flex; flex-direction:column;">
		<div class="cp-card" style="padding:0; display:flex; flex-direction:column; min-height:600px; max-height:700px; overflow:hidden; border:1px solid rgba(255,255,255,0.08);">
			<!-- Chat Header -->
			<div style="background:rgba(30,41,59,0.7); border-bottom:1px solid rgba(255,255,255,0.06); padding:1rem 1.25rem; display:flex; justify-content:space-between; align-items:center;">
				<div style="display:flex; align-items:center; gap:0.75rem;">
					<div style="width:34px; height:34px; border-radius:50%; background:rgba(6,182,212,0.1); border:1px solid rgba(6,182,212,0.25); display:flex; align-items:center; justify-content:center; font-size:1.1rem;">
						🤖
					</div>
					<div>
						<h3 style="font-size:0.95rem; font-weight:700; color:#ffffff; margin:0; line-height:1.2;">
							<?php echo esc_html( $plugin->settings->get( 'general.plugin_name', 'Chat Pilot' ) ); ?>
						</h3>
						<span style="font-size:0.75rem; color:var(--accent-cyan); font-weight:600;"><?php esc_html_e( 'AI Assistant Simulator', 'chat-pilot' ); ?></span>
					</div>
				</div>
				<div style="display:flex; gap:0.5rem;">
					<button type="button" id="cp-play-clear" class="cp-btn cp-btn-sm cp-btn-secondary" style="margin:0; font-size:0.8rem; padding:0.35rem 0.75rem;">
						🧹 <?php esc_html_e( 'Clear Chat', 'chat-pilot' ); ?>
					</button>
				</div>
			</div>

			<!-- Pre-chat Form Container (Shown when pre-chat form is active) -->
			<div id="cp-play-prechat-panel" style="display:none; flex-grow:1; padding:2rem; overflow-y:auto;">
				<div style="max-width:480px; margin:0 auto; display:flex; flex-direction:column; gap:1.25rem;">
					<p style="font-size:0.95rem; color:var(--text-secondary); margin:0; line-height:1.5; text-align:center;">
						<?php esc_html_e( 'Please introduce yourself to start the conversation.', 'chat-pilot' ); ?>
					</p>
					<div id="cp-play-prechat-error" style="display:none; color:#ef4444; font-size:0.85rem; border:1px solid rgba(239,68,68,0.2); background:rgba(239,68,68,0.08); padding:0.6rem 0.85rem; border-radius:8px; line-height:1.4;"></div>
					
					<div id="cp-play-prechat-fields" style="display:flex; flex-direction:column; gap:1rem;">
						<!-- Dynamic fields rendered by JS -->
					</div>

					<button type="button" id="cp-play-prechat-submit" class="cp-btn cp-btn-primary" style="margin-top:0.5rem; width:100%; padding:0.65rem 1rem; font-size:0.9rem; border-radius:8px;">
						<?php esc_html_e( 'Start Chat', 'chat-pilot' ); ?>
					</button>
				</div>
			</div>

			<!-- Messages log viewport -->
			<div id="cp-play-messages" style="flex-grow:1; overflow-y:auto; padding:1.5rem; display:flex; flex-direction:column; gap:1.25rem; scroll-behavior:smooth;">
				<!-- Welcome message -->
				<div style="align-self:flex-start; max-width:85%; display:flex; gap:0.5rem;" class="cp-play-msg cp-play-msg-bot">
					<div style="background:rgba(30,41,59,0.8); border:1px solid rgba(255,255,255,0.05); color:#e2e8f0; padding:0.75rem 1rem; border-radius:12px; border-top-left-radius:4px; font-size:0.9rem; line-height:1.5; word-break:break-word; position:relative;">
						<?php echo esc_html( $welcome_msg ); ?>
					</div>
				</div>
			</div>

			<!-- Quick action control buttons bar -->
			<div style="background:rgba(15,23,42,0.4); border-top:1px solid rgba(255,255,255,0.04); padding:0.6rem 1.25rem; display:flex; gap:0.75rem; align-items:center;">
				<button type="button" id="cp-play-regenerate" class="cp-btn cp-btn-sm cp-btn-secondary" style="margin:0; font-size:0.75rem; padding:0.3rem 0.65rem;" disabled>
					🔄 <?php esc_html_e( 'Regenerate Response', 'chat-pilot' ); ?>
				</button>
				<button type="button" id="cp-play-retry" class="cp-btn cp-btn-sm cp-btn-secondary" style="margin:0; font-size:0.75rem; padding:0.3rem 0.65rem;" disabled>
					✏️ <?php esc_html_e( 'Retry Last Message', 'chat-pilot' ); ?>
				</button>
				<span style="font-size:0.75rem; color:var(--text-muted); margin-left:auto;">
					<?php esc_html_e( 'Transcripts saved to active session cache memory.', 'chat-pilot' ); ?>
				</span>
			</div>

			<!-- Input form footer -->
			<div style="padding:1rem 1.25rem; border-top:1px solid rgba(255,255,255,0.05); background:rgba(15,23,42,0.9);">
				<form id="cp-play-input-form" style="display:flex; gap:0.5rem; align-items:center;">
					<input type="text" id="cp-play-input-field" class="cp-input" style="flex-grow:1; margin:0 !important;" placeholder="<?php echo esc_attr( $placeholder ); ?>" autocomplete="off">
					<button type="submit" id="cp-play-send-btn" class="cp-btn cp-btn-primary" style="margin:0; width:42px; height:42px; padding:0; display:flex; align-items:center; justify-content:center; border-radius:8px;">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px; height:18px;"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
					</button>
				</form>
			</div>
		</div>
	</div>

	<!-- Right Side collapsible debug panel -->
	<div class="cp-grid-sidebar" id="cp-playground-debug-panel" style="display:block; transition: all 0.3s ease;">
		<div style="display:flex; flex-direction:column; gap:1.5rem; min-height:600px;">
			
			<!-- Pipeline Diagnostics Panel -->
			<div class="cp-card" style="border:1px solid rgba(255,255,255,0.08); padding: 1.25rem;">
				<h3 class="cp-card-title" style="color:var(--accent-cyan); display:flex; align-items:center; gap:0.5rem; border-bottom:1px solid rgba(255,255,255,0.06); padding-bottom:0.75rem; margin-bottom:1.25rem; font-size:1.05rem;">
					🛠️ <?php esc_html_e( 'Pipeline Diagnostics', 'chat-pilot' ); ?>
				</h3>

				<div style="display:flex; flex-direction:column; gap:1.25rem;">
					<!-- Intent Classification -->
					<div style="display:flex; justify-content:space-between; align-items:center;">
						<span style="font-size:0.85rem; font-weight:600; color:var(--text-secondary);"><?php esc_html_e( 'Intent Detected', 'chat-pilot' ); ?></span>
						<span id="cp-diag-intent" style="font-weight:700; color:#ffffff; font-size:0.85rem; padding:0.25rem 0.5rem; border-radius:4px; background:rgba(255,255,255,0.05);">—</span>
					</div>

					<!-- RAG Matching Stats -->
					<div>
						<h4 style="font-size:0.8rem; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:rgba(255,255,255,0.4); margin:0 0 0.5rem 0;">
							1. Retrieval Database Context
						</h4>
						<ul class="cp-info-list" style="font-size:0.82rem; gap:0.5rem;">
							<li class="cp-info-row" style="padding:0.25rem 0;">
								<span class="cp-info-label"><?php esc_html_e( 'Match Confidence', 'chat-pilot' ); ?></span>
								<span class="cp-info-value" id="cp-db-confidence-badge" style="font-weight:700; padding: 0.15rem 0.4rem; border-radius: 4px; font-size:0.75rem; background:rgba(255,255,255,0.05); color:#ffffff;">—</span>
							</li>
							<li class="cp-info-row" style="padding:0.25rem 0;">
								<span class="cp-info-label"><?php esc_html_e( 'Similarity Score', 'chat-pilot' ); ?></span>
								<span class="cp-info-value" id="cp-db-similarity" style="font-family:monospace; color:var(--accent-cyan); font-weight:700;">—</span>
							</li>
							<li class="cp-info-row" style="padding:0.25rem 0;">
								<span class="cp-info-label"><?php esc_html_e( 'Confidence Threshold', 'chat-pilot' ); ?></span>
								<span class="cp-info-value" id="cp-db-threshold" style="font-family:monospace; color:var(--text-secondary);">—</span>
							</li>
							<li class="cp-info-row" style="padding:0.25rem 0;">
								<span class="cp-info-label"><?php esc_html_e( 'Sources Used', 'chat-pilot' ); ?></span>
								<span class="cp-info-value" id="cp-db-sources-used" style="font-weight:700; color:#e2e8f0;">—</span>
							</li>
						</ul>
					</div>

					<!-- Source checklist indicators -->
					<div style="background:rgba(0,0,0,0.15); border:1px solid rgba(255,255,255,0.03); border-radius:8px; padding:0.75rem;">
						<div style="font-size:0.75rem; color:var(--text-muted); font-weight:700; margin-bottom:0.4rem; text-transform:uppercase;"><?php esc_html_e( 'Retrieved Sources Checklist', 'chat-pilot' ); ?></div>
						<div style="display:grid; grid-template-columns:1fr 1fr; gap:0.4rem; font-size:0.8rem;">
							<div id="src-chk-faq" style="color:var(--text-muted);">☐ FAQ</div>
							<div id="src-chk-manual" style="color:var(--text-muted);">☐ Manual</div>
							<div id="src-chk-file" style="color:var(--text-muted);">☐ File</div>
							<div id="src-chk-website" style="color:var(--text-muted);">☐ Website</div>
						</div>
					</div>

					<!-- Source priority indicator flowchart flow -->
					<div>
						<h4 style="font-size:0.8rem; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:rgba(255,255,255,0.4); margin:0 0 0.5rem 0;">
							2. Source Priority Hierarchy
						</h4>
						<div class="cp-source-priority-flow" style="display:flex; justify-content:space-between; align-items:center; gap:0.2rem; background:rgba(0,0,0,0.2); padding:0.6rem; border-radius:8px; border:1px solid rgba(255,255,255,0.05); font-size:0.7rem; font-weight:700;">
							<div id="flow-faq" style="flex:1; text-align:center; padding:0.35rem 0.15rem; border-radius:4px; border:1px solid rgba(255,255,255,0.08); color:var(--text-muted); text-transform:uppercase;">FAQ</div>
							<span style="color:rgba(255,255,255,0.15);">➔</span>
							<div id="flow-manual" style="flex:1; text-align:center; padding:0.35rem 0.15rem; border-radius:4px; border:1px solid rgba(255,255,255,0.08); color:var(--text-muted); text-transform:uppercase;">Manual</div>
							<span style="color:rgba(255,255,255,0.15);">➔</span>
							<div id="flow-file" style="flex:1; text-align:center; padding:0.35rem 0.15rem; border-radius:4px; border:1px solid rgba(255,255,255,0.08); color:var(--text-muted); text-transform:uppercase;">File</div>
							<span style="color:rgba(255,255,255,0.15);">➔</span>
							<div id="flow-website" style="flex:1; text-align:center; padding:0.35rem 0.15rem; border-radius:4px; border:1px solid rgba(255,255,255,0.08); color:var(--text-muted); text-transform:uppercase;">Web</div>
						</div>
					</div>

					<!-- LLM Provider Execution Metrics -->
					<div>
						<h4 style="font-size:0.8rem; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:rgba(255,255,255,0.4); margin:0 0 0.5rem 0;">
							3. Provider & Latency Parameters
						</h4>
						<ul class="cp-info-list" style="font-size:0.82rem; gap:0.5rem;">
							<li class="cp-info-row" style="padding:0.25rem 0;">
								<span class="cp-info-label"><?php esc_html_e( 'AI Provider', 'chat-pilot' ); ?></span>
								<span class="cp-info-value" id="cp-llm-provider" style="font-weight:700; text-transform:uppercase;">—</span>
							</li>
							<li class="cp-info-row" style="padding:0.25rem 0;">
								<span class="cp-info-label"><?php esc_html_e( 'Model Invoked', 'chat-pilot' ); ?></span>
								<span class="cp-info-value" id="cp-llm-model" style="font-family:monospace; font-size:0.75rem;">—</span>
							</li>
							<li class="cp-info-row" id="cp-llm-error-row" style="display:none; padding:0.25rem 0; color:#ef4444; border-top:1px solid rgba(239,68,68,0.15); margin-top:0.25rem; padding-top:0.25rem;">
								<span class="cp-info-label" style="color:#ef4444; font-weight:700;"><?php esc_html_e( 'API Error', 'chat-pilot' ); ?></span>
								<span class="cp-info-value" id="cp-llm-error" style="font-weight:700; color:#ef4444; font-size:0.75rem; word-break:break-word; text-align:right;">—</span>
							</li>
							<li class="cp-info-row" style="padding:0.25rem 0;">
								<span class="cp-info-label"><?php esc_html_e( 'Execution Latency', 'chat-pilot' ); ?></span>
								<span class="cp-info-value" id="cp-llm-latency" style="color:var(--accent-green); font-weight:700;">—</span>
							</li>
							<li class="cp-info-row" style="padding:0.25rem 0;">
								<span class="cp-info-label"><?php esc_html_e( 'Tokens Consumed', 'chat-pilot' ); ?></span>
								<span class="cp-info-value" id="cp-llm-tokens" style="color:var(--accent-purple); font-weight:700;">—</span>
							</li>
						</ul>
					</div>

					<!-- Sizing diagnostics data -->
					<div>
						<h4 style="font-size:0.8rem; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:rgba(255,255,255,0.4); margin:0 0 0.5rem 0;">
							4. Context & Prompts Sizing
						</h4>
						<ul class="cp-info-list" style="font-size:0.82rem; gap:0.5rem;">
							<li class="cp-info-row" style="padding:0.25rem 0;">
								<span class="cp-info-label"><?php esc_html_e( 'Context Segment size', 'chat-pilot' ); ?></span>
								<span class="cp-info-value" id="cp-size-context" style="font-family:monospace;">—</span>
							</li>
							<li class="cp-info-row" style="padding:0.25rem 0;">
								<span class="cp-info-label"><?php esc_html_e( 'Prompt Payload size', 'chat-pilot' ); ?></span>
								<span class="cp-info-value" id="cp-size-prompt" style="font-family:monospace;">—</span>
							</li>
							<li class="cp-info-row" style="padding:0.25rem 0;">
								<span class="cp-info-label"><?php esc_html_e( 'Response size', 'chat-pilot' ); ?></span>
								<span class="cp-info-value" id="cp-size-completion" style="font-family:monospace;">—</span>
							</li>
						</ul>
					</div>
				</div>
			</div>

			<!-- Live Context Viewer Panel (Monospace collapsibles) -->
			<div class="cp-card" style="border:1px solid rgba(255,255,255,0.08); padding: 1.25rem;">
				<h3 class="cp-card-title" style="color:var(--accent-purple); display:flex; align-items:center; gap:0.5rem; border-bottom:1px solid rgba(255,255,255,0.06); padding-bottom:0.75rem; margin-bottom:1rem; font-size:1.05rem;">
					👁️ <?php esc_html_e( 'Live Context Viewer', 'chat-pilot' ); ?>
				</h3>
				
				<div style="display:flex; flex-direction:column; gap:0.5rem;">
					<!-- FAQ Context -->
					<div class="cp-context-collapsible" style="border-bottom: 1px solid rgba(255,255,255,0.04); padding-bottom: 0.5rem;">
						<div class="cp-context-toggle" style="display:flex; justify-content:between; align-items:center; cursor:pointer; font-weight:700; font-size:0.8rem; color:#cbd5e1; padding:0.25rem 0;">
							<span>FAQ Context</span>
							<span style="margin-left:auto; font-size:0.7rem;">▼</span>
						</div>
						<textarea id="cp-view-faq" class="cp-input" style="display:none; height:80px; font-family:monospace; font-size:0.75rem; background:rgba(0,0,0,0.3); color:#e2e8f0; width:100%; resize:none; margin-top:0.4rem;" readonly></textarea>
					</div>

					<!-- Manual Context -->
					<div class="cp-context-collapsible" style="border-bottom: 1px solid rgba(255,255,255,0.04); padding-bottom: 0.5rem;">
						<div class="cp-context-toggle" style="display:flex; justify-content:between; align-items:center; cursor:pointer; font-weight:700; font-size:0.8rem; color:#cbd5e1; padding:0.25rem 0;">
							<span>Manual Context</span>
							<span style="margin-left:auto; font-size:0.7rem;">▼</span>
						</div>
						<textarea id="cp-view-manual" class="cp-input" style="display:none; height:80px; font-family:monospace; font-size:0.75rem; background:rgba(0,0,0,0.3); color:#e2e8f0; width:100%; resize:none; margin-top:0.4rem;" readonly></textarea>
					</div>

					<!-- Website Context -->
					<div class="cp-context-collapsible" style="border-bottom: 1px solid rgba(255,255,255,0.04); padding-bottom: 0.5rem;">
						<div class="cp-context-toggle" style="display:flex; justify-content:between; align-items:center; cursor:pointer; font-weight:700; font-size:0.8rem; color:#cbd5e1; padding:0.25rem 0;">
							<span>Website Context</span>
							<span style="margin-left:auto; font-size:0.7rem;">▼</span>
						</div>
						<textarea id="cp-view-website" class="cp-input" style="display:none; height:80px; font-family:monospace; font-size:0.75rem; background:rgba(0,0,0,0.3); color:#e2e8f0; width:100%; resize:none; margin-top:0.4rem;" readonly></textarea>
					</div>

					<!-- Documents Context -->
					<div class="cp-context-collapsible" style="border-bottom: 1px solid rgba(255,255,255,0.04); padding-bottom: 0.5rem;">
						<div class="cp-context-toggle" style="display:flex; justify-content:between; align-items:center; cursor:pointer; font-weight:700; font-size:0.8rem; color:#cbd5e1; padding:0.25rem 0;">
							<span>Documents Context</span>
							<span style="margin-left:auto; font-size:0.7rem;">▼</span>
						</div>
						<textarea id="cp-view-file" class="cp-input" style="display:none; height:80px; font-family:monospace; font-size:0.75rem; background:rgba(0,0,0,0.3); color:#e2e8f0; width:100%; resize:none; margin-top:0.4rem;" readonly></textarea>
					</div>

					<!-- AI Instructions -->
					<div class="cp-context-collapsible" style="border-bottom: 1px solid rgba(255,255,255,0.04); padding-bottom: 0.5rem;">
						<div class="cp-context-toggle" style="display:flex; justify-content:between; align-items:center; cursor:pointer; font-weight:700; font-size:0.8rem; color:#cbd5e1; padding:0.25rem 0;">
							<span>AI System Directives</span>
							<span style="margin-left:auto; font-size:0.7rem;">▼</span>
						</div>
						<textarea id="cp-view-instructions" class="cp-input" style="display:none; height:80px; font-family:monospace; font-size:0.75rem; background:rgba(0,0,0,0.3); color:#e2e8f0; width:100%; resize:none; margin-top:0.4rem;" readonly></textarea>
					</div>

					<!-- Merged Prompt -->
					<div class="cp-context-collapsible" style="padding-bottom: 0.25rem;">
						<div class="cp-context-toggle" style="display:flex; justify-content:between; align-items:center; cursor:pointer; font-weight:700; font-size:0.8rem; color:#cbd5e1; padding:0.25rem 0;">
							<span>Merged LLM Prompt</span>
							<span style="margin-left:auto; font-size:0.7rem;">▼</span>
						</div>
						<textarea id="cp-view-prompt" class="cp-input" style="display:none; height:120px; font-family:monospace; font-size:0.75rem; background:rgba(0,0,0,0.3); color:#e2e8f0; width:100%; resize:none; margin-top:0.4rem;" readonly></textarea>
					</div>
				</div>
			</div>
			
		</div>
	</div>
</div>
