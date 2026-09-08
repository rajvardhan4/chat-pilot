/**
 * Chat Pilot Premium Admin Interactivity Scripts
 * Brand: Local Marketing Geeks
 */

(function($) {
	'use strict';

	$(document).ready(function() {
		// Elements.
		var $container = $('#chat-pilot-container');
		var $settingsForm = $('#cp-settings-form');
		var $notification = $('#cp-notification');
		
		// 0. Horizontal Navigation Scroll Position Preservation & Active Tab Visibility
		var $nav = $('.cp-tabs-nav');
		if ($nav.length) {
			var savedScrollLeft = sessionStorage.getItem('cp_nav_scroll_left');

			// Save scroll position on scroll or tab click
			$nav.on('scroll', function() {
				sessionStorage.setItem('cp_nav_scroll_left', this.scrollLeft);
			});

			$nav.on('click', '.cp-tab-link', function() {
				if (this.scrollLeft !== undefined) {
					sessionStorage.setItem('cp_nav_scroll_left', $nav[0].scrollLeft);
				}
			});

			// Restore saved scroll position or auto-scroll active tab into view
			var restoreScroll = function() {
				var navElem = $nav[0];
				if (savedScrollLeft !== null && savedScrollLeft !== undefined) {
					navElem.scrollLeft = parseInt(savedScrollLeft, 10);
				}

				// Ensure the active tab is visible within the nav viewport
				var $activeTab = $nav.find('.cp-tab-link.active');
				if ($activeTab.length) {
					var navLeft = navElem.scrollLeft;
					var navRight = navLeft + $nav.width();
					var tabLeft = $activeTab[0].offsetLeft;
					var tabRight = tabLeft + $activeTab.outerWidth();

					if (tabLeft < navLeft || tabRight > navRight) {
						navElem.scrollLeft = Math.max(0, tabLeft - 20);
						sessionStorage.setItem('cp_nav_scroll_left', navElem.scrollLeft);
					}
				}
			};

			restoreScroll();
			$(window).on('resize orientationchange', restoreScroll);

			// Horizontal Mouse Wheel Scrolling
			$nav.on('wheel', function(e) {
				if (e.originalEvent.deltaY !== 0) {
					e.preventDefault();
					navElemScroll(this, e.originalEvent.deltaY * 0.8);
				}
			});

			function navElemScroll(elem, delta) {
				elem.scrollLeft += delta;
				sessionStorage.setItem('cp_nav_scroll_left', elem.scrollLeft);
			}
		}

		// 1. Settings form submission handler (General/System).
		if ($settingsForm.length) {
			$settingsForm.on('submit', function(e) {
				e.preventDefault();
				
				var $submitBtn = $settingsForm.find('button[type="submit"]');
				var originalBtnHtml = $submitBtn.html();
				
				$submitBtn.prop('disabled', true).html('<span class="spinner is-active" style="float:none; margin:0 5px 0 0;"></span> Saving...');
				
				var formData = $settingsForm.serializeArray();
				formData.push({ name: 'action', value: 'chat_pilot_save_settings' });
				formData.push({ name: '_wpnonce', value: chatPilotAdmin.securityNonce });
				
				$.ajax({
					url: chatPilotAdmin.ajaxUrl,
					type: 'POST',
					data: formData,
					dataType: 'json',
					success: function(response) {
						if (response.success) {
							showNotification(response.data.message || 'Settings saved successfully!', 'success');
							if (response.data.refresh) {
								setTimeout(function() {
									window.location.reload();
								}, 1000);
							}
						} else {
							showNotification(response.data.message || 'An error occurred while saving.', 'error');
						}
					},
					error: function() {
						showNotification('A system-level error occurred during saving.', 'error');
					},
					complete: function() {
						$submitBtn.prop('disabled', false).html(originalBtnHtml);
					}
				});
			});
		}

		// 2. Provider Selection Tab Dropdown Switcher.
		var $providerSelector = $('#selected_provider_tab');
		if ($providerSelector.length) {
			$providerSelector.on('change', function() {
				var slug = $(this).val();
				localStorage.setItem('cp_last_active_provider', slug);
				
				// Hide all form panels, show the selected one.
				$('.cp-provider-card').hide();
				$('.cp-provider-card[data-slug="' + slug + '"]').show();
				
				// Hide all health monitors, show the selected one.
				$('.cp-health-block').hide();
				$('.cp-health-block[data-slug="' + slug + '"]').show();
				
				// Update Developer Testing Tools quick action link dynamically.
				var name = (slug === 'openai') ? 'OpenAI' : 'Google Gemini';
				var baseUrl = window.location.pathname;
				var url = baseUrl + '?page=chat-pilot&tab=playground&provider=' + slug;
				$('#cp-js-playground-link').attr('href', url).text('Open ' + name + ' Playground');
			});
			
			// Load last active provider from localStorage if exists.
			var lastActiveProvider = localStorage.getItem('cp_last_active_provider') || 'openai';
			$providerSelector.val(lastActiveProvider);
			
			// Trigger initially to establish correct active elements.
			$providerSelector.trigger('change');
		}

		// 3. Global Defaults Dropdown Real-time Synchronization & UX Layouts.
		function syncGlobalDefaultDropdown() {
			var $defaultProviderSelect = $('#default_provider');
			if (!$defaultProviderSelect.length) {
				return;
			}
			
			var connectedProviders = [];
			if (window.chatPilotProvidersState) {
				$.each(window.chatPilotProvidersState, function(slug, state) {
					var statusLower = (state.status || '').toLowerCase();
					if (statusLower === 'connected') {
						connectedProviders.push({
							slug: slug,
							name: state.name,
							default_model: state.default_model,
							models: state.models
						});
					}
				});
			}

			var $singleView = $('#cp-defaults-single');
			var $dropdownsView = $('#cp-defaults-dropdowns');
			var $emptyView = $('#cp-defaults-empty');
			var $saveBtn = $('#cp-defaults-save-btn');

			// Hide all initially.
			$singleView.hide();
			$dropdownsView.hide();
			$emptyView.hide();
			$saveBtn.hide();

			if (connectedProviders.length === 0) {
				// Scenario 3: No connected providers
				$emptyView.show();
			} else if (connectedProviders.length === 1) {
				// Scenario 1: Exactly 1 connected provider (Automatic Default display)
				var singleProv = connectedProviders[0];
				
				$('#cp-single-provider-name').text(singleProv.name);
				$('#cp-single-provider-input').val(singleProv.slug);
				
				var activeModelName = singleProv.default_model || (singleProv.models && singleProv.models.length ? singleProv.models[0] : '— None Discovered —');
				$('#cp-single-model-name').text(activeModelName);
				$('#cp-single-model-input').val(activeModelName);
				
				$singleView.show();

				// Auto-synchronize in database via AJAX background post if changed.
				var prevProvider = chatPilotAdmin.defaultProvider;
				var prevModel = chatPilotAdmin.defaultModel;
				if (prevProvider !== singleProv.slug || prevModel !== activeModelName) {
					$.ajax({
						url: chatPilotAdmin.ajaxUrl,
						type: 'POST',
						data: {
							action: 'chat_pilot_save_defaults',
							default_provider: singleProv.slug,
							default_model: activeModelName,
							_wpnonce: chatPilotAdmin.securityNonce
						},
						success: function(res) {
							if (res.success) {
								chatPilotAdmin.defaultProvider = singleProv.slug;
								chatPilotAdmin.defaultModel = activeModelName;
							}
						}
					});
				}
			} else {
				// Scenario 2: Multiple connected providers
				var currentVal = $defaultProviderSelect.val() || chatPilotAdmin.defaultProvider;
				$defaultProviderSelect.empty().append($('<option></option>').val('').text('— Select Default Provider —'));
				
				$.each(connectedProviders, function(i, p) {
					var defaultModelStr = p.default_model ? ' (' + p.default_model + ')' : '';
					var label = p.name + defaultModelStr;
					var $option = $('<option></option>').val(p.slug).text(label);
					if (p.slug === currentVal) {
						$option.prop('selected', true);
					}
					$defaultProviderSelect.append($option);
				});

				$dropdownsView.show();
				$saveBtn.show();
				
				// Re-bind model overrides.
				$defaultProviderSelect.trigger('change');
			}
		}

		// 4. AI Providers Settings Form Submits.
		$container.on('submit', '.cp-provider-settings-form', function(e) {
			e.preventDefault();
			var $form = $(this);
			var $submitBtn = $form.find('button[type="submit"]');
			var originalBtnHtml = $submitBtn.html();

			$submitBtn.prop('disabled', true).html('<span class="spinner is-active" style="float:none; margin:0 5px 0 0;"></span> Saving...');

			var formData = $form.serializeArray();
			formData.push({ name: 'action', value: 'chat_pilot_save_provider' });
			formData.push({ name: '_wpnonce', value: chatPilotAdmin.securityNonce });

			$.ajax({
				url: chatPilotAdmin.ajaxUrl,
				type: 'POST',
				data: formData,
				dataType: 'json',
				success: function(response) {
					if (response.success) {
						showNotification(response.data.message, 'success');
						
						// Update default model in state
						var slug = $form.find('input[name="provider_slug"]').val();
						var defaultModel = $form.find('.cp-model-select').val();
						if (window.chatPilotProvidersState && window.chatPilotProvidersState[slug]) {
							window.chatPilotProvidersState[slug].default_model = defaultModel;
						}
						
						syncGlobalDefaultDropdown();
					} else {
						showNotification(response.data.message, 'error');
					}
				},
				error: function() {
					showNotification('Connection error while saving provider config.', 'error');
				},
				complete: function() {
					$submitBtn.prop('disabled', false).html(originalBtnHtml);
				}
			});
		});

		// 5. AI Providers Active/Enable Checkbox Toggling.
		$container.on('change', '.cp-js-toggle-provider', function() {
			var $checkbox = $(this);
			var $card = $checkbox.closest('.cp-provider-card');
			var slug = $card.data('slug');
			var $form = $card.find('.cp-provider-settings-form');
			
			var isChecked = $checkbox.is(':checked');
			
			// Prevent checking the box if the status is not 'Connected' (or 'connected').
			var currentStatus = (window.chatPilotProvidersState && window.chatPilotProvidersState[slug]) ? window.chatPilotProvidersState[slug].status : '';
			if (isChecked && (!currentStatus || currentStatus.toLowerCase() !== 'connected')) {
				$checkbox.prop('checked', false);
				showNotification('The provider cannot be activated until a successful connection has been established.', 'error');
				return;
			}
			
			$form.find('.provider-enabled-hidden').val(isChecked ? '1' : '0');
			
			// Update state.
			if (window.chatPilotProvidersState && window.chatPilotProvidersState[slug]) {
				window.chatPilotProvidersState[slug].enabled = isChecked;
			}
			
			syncGlobalDefaultDropdown();
		});

		// 6. Test Connection AJAX Trigger.
		$container.on('click', '.cp-js-test-connection', function(e) {
			e.preventDefault();
			var $btn = $(this);
			var $form = $btn.closest('form');
			var $card = $btn.closest('.cp-provider-card');
			var slug = $card.data('slug');
			var originalBtnHtml = $btn.html();

			$btn.prop('disabled', true).html('<span class="spinner is-active" style="float:none; margin:0 5px 0 0;"></span> Testing...');

			var formData = $form.serializeArray();
			formData.push({ name: 'action', value: 'chat_pilot_test_connection' });
			formData.push({ name: 'provider_slug', value: slug });
			formData.push({ name: '_wpnonce', value: chatPilotAdmin.securityNonce });

			$.ajax({
				url: chatPilotAdmin.ajaxUrl,
				type: 'POST',
				data: formData,
				dataType: 'json',
				success: function(response) {
					if (response.success) {
						showNotification(response.data.message + ' Latency: ' + response.data.latency + 'ms', 'success');
						
						var statusText = response.data.status || 'Connected';
						var statusClass = statusText.replace(/\s+/g, '-');
						
						// Auto-check Active checkbox since it passed successfully.
						var $checkbox = $card.find('.cp-js-toggle-provider');
						$checkbox.prop('checked', true);
						$form.find('.provider-enabled-hidden').val('1');

						// Update status badge on card.
						var $cardBadge = $card.find('.cp-js-status-badge');
						$cardBadge.removeClass('disconnected error connected Authentication-Failed Connection-Failed Rate-Limited API-Unavailable Not-Configured Not-Yet-Verified').addClass(statusClass).text(statusText);
						
						// Update health metrics.
						var $healthBlock = $('.cp-health-block[data-slug="' + slug + '"]');
						$healthBlock.find('.cp-js-health-badge').removeClass('disconnected error connected Authentication-Failed Connection-Failed Rate-Limited API-Unavailable Not-Configured Not-Yet-Verified').addClass(statusClass).text(statusText);
						$healthBlock.find('.cp-js-health-latency').text(response.data.latency + ' ms');
						$healthBlock.find('.cp-js-health-errors').text('0').css('color', 'inherit');
						$healthBlock.find('.cp-js-health-success').text('Just now');
						
						// Rebuild Model Dropdown.
						if (response.data.models && response.data.models.length) {
							var $modelSelect = $form.find('.cp-model-select');
							$modelSelect.empty();
							$.each(response.data.models, function(i, val) {
								$modelSelect.append($('<option></option>').val(val).text(val));
							});
							
							// Update local JS state cache.
							if (window.chatPilotProvidersState && window.chatPilotProvidersState[slug]) {
								window.chatPilotProvidersState[slug].models = response.data.models;
								window.chatPilotProvidersState[slug].status = statusText;
								window.chatPilotProvidersState[slug].enabled = true;
								window.chatPilotProvidersState[slug].has_key = true;
								if (!window.chatPilotProvidersState[slug].default_model) {
									window.chatPilotProvidersState[slug].default_model = response.data.models[0];
								}
							}
							if (window.chatPilotPlaygroundModels) {
								window.chatPilotPlaygroundModels[slug] = response.data.models;
							}
							if (window.chatPilotInstructionsModels) {
								window.chatPilotInstructionsModels[slug] = response.data.models;
							}
						} else {
							if (window.chatPilotProvidersState && window.chatPilotProvidersState[slug]) {
								window.chatPilotProvidersState[slug].status = statusText;
								window.chatPilotProvidersState[slug].enabled = true;
								window.chatPilotProvidersState[slug].has_key = true;
							}
						}
						
						syncGlobalDefaultDropdown();
					} else {
						var statusText = response.data && response.data.status ? response.data.status : 'Connection Failed';
						var statusClass = statusText.replace(/\s+/g, '-');
						var errorMsg = response.data && response.data.message ? response.data.message : 'Connection test failed.';
						showNotification(errorMsg, 'error');
						
						// Auto-uncheck Active checkbox since it failed.
						var $checkbox = $card.find('.cp-js-toggle-provider');
						$checkbox.prop('checked', false);
						$form.find('.provider-enabled-hidden').val('0');

						// Update status badge on card to error.
						var $cardBadge = $card.find('.cp-js-status-badge');
						$cardBadge.removeClass('disconnected error connected Authentication-Failed Connection-Failed Rate-Limited API-Unavailable Not-Configured Not-Yet-Verified').addClass(statusClass).text(statusText);
						
						// Update health metrics.
						var $healthBlock = $('.cp-health-block[data-slug="' + slug + '"]');
						var $healthBadge = $healthBlock.find('.cp-js-health-badge');
						$healthBadge.removeClass('disconnected error connected Authentication-Failed Connection-Failed Rate-Limited API-Unavailable Not-Configured Not-Yet-Verified').addClass(statusClass).text(statusText);
						
						var currentErrors = parseInt($healthBlock.find('.cp-js-health-errors').text(), 10) || 0;
						$healthBlock.find('.cp-js-health-errors').text(currentErrors + 1).css('color', 'var(--accent-red)');
						$healthBlock.find('.cp-js-health-failure').text('Just now');
						
						// Update state status.
						if (window.chatPilotProvidersState && window.chatPilotProvidersState[slug]) {
							window.chatPilotProvidersState[slug].status = statusText;
							window.chatPilotProvidersState[slug].enabled = false;
						}
						
						syncGlobalDefaultDropdown();
					}
				},
				error: function() {
					showNotification('Connection request failed.', 'error');
				},
				complete: function() {
					$btn.prop('disabled', false).html(originalBtnHtml);
				}
			});
		});

		// 7. Global Defaults Configs (Provider & Model selects binding).
		var $defaultsForm = $('#cp-defaults-form');
		if ($defaultsForm.length) {
			var $defaultProviderSelect = $('#default_provider');
			var $defaultModelSelect = $('#default_model');

			$defaultProviderSelect.on('change', function() {
				var slug = $(this).val();
				$defaultModelSelect.empty().append($('<option></option>').val('').text('— Select Default Model —'));
				
				if (slug && window.chatPilotPlaygroundModels && window.chatPilotPlaygroundModels[slug]) {
					$.each(window.chatPilotPlaygroundModels[slug], function(i, val) {
						$defaultModelSelect.append($('<option></option>').val(val).text(val));
					});
					
					// Set previous value if matches.
					var selectedOverride = $defaultModelSelect.data('selected-value') || chatPilotAdmin.defaultModel;
					if (selectedOverride) {
						$defaultModelSelect.val(selectedOverride);
					}
				}
			});

			// Perform initial dropdown sync and defaults binding.
			syncGlobalDefaultDropdown();

			$defaultsForm.on('submit', function(e) {
				e.preventDefault();
				
				// Handle both scenarios (single hidden inputs vs dropdown values)
				var provVal = $defaultProviderSelect.is(':visible') ? $defaultProviderSelect.val() : $('#cp-single-provider-input').val();
				var modelVal = $defaultModelSelect.is(':visible') ? $defaultModelSelect.val() : $('#cp-single-model-input').val();

				var $submitBtn = $defaultsForm.find('button[type="submit"]');
				var originalBtnHtml = $submitBtn.html();

				$submitBtn.prop('disabled', true).html('<span class="spinner is-active" style="float:none; margin:0 5px 0 0;"></span> Saving...');

				$.ajax({
					url: chatPilotAdmin.ajaxUrl,
					type: 'POST',
					data: {
						action: 'chat_pilot_save_defaults',
						default_provider: provVal,
						default_model: modelVal,
						_wpnonce: chatPilotAdmin.securityNonce
					},
					dataType: 'json',
					success: function(response) {
						if (response.success) {
							showNotification(response.data.message, 'success');
							chatPilotAdmin.defaultProvider = provVal;
							chatPilotAdmin.defaultModel = modelVal;
						} else {
							showNotification(response.data.message, 'error');
						}
					},
					error: function() {
						showNotification('System connection error while saving global defaults.', 'error');
					},
					complete: function() {
						$submitBtn.prop('disabled', false).html(originalBtnHtml);
					}
				});
			});
		}

		// 8. Interactive Developer Chat Preview Controls Binding.
		var $playgroundContainer = $('.cp-playground-container');
		if ($playgroundContainer.length) {
			var playgroundHistory = [];
			var lastRetrievedDocs = [];
			var lastUserMessage = '';
			var debugLogCache     = []; // Session transcript memory logs

			var $playForm     = $('#cp-play-input-form');
			var $playField    = $('#cp-play-input-field');
			var $playMessages = $('#cp-play-messages');
			var $sendBtn      = $('#cp-play-send-btn');
			var $btnRegen     = $('#cp-play-regenerate');
			var $btnRetry     = $('#cp-play-retry');

			var playSessionId = 'cp_play_sess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
			localStorage.setItem('cp_play_session_id', playSessionId);

			function initPlaygroundPrechat() {
				var lastEditedId = localStorage.getItem('cp_last_edited_form_id');
				var userChanged = $('#cp-play-form-selector').data('user-changed');
				var selectedFormId = userChanged ? $('#cp-play-form-selector').val() : (lastEditedId || chatPilotAdmin.formId || $('#cp-play-form-selector').val());

				if ($('#cp-play-form-selector').length && selectedFormId) {
					$('#cp-play-form-selector').val(selectedFormId);
				}

				var formFields = [];
				if (selectedFormId && chatPilotAdmin.allForms && chatPilotAdmin.allForms.length) {
					$.each(chatPilotAdmin.allForms, function(i, f) {
						if (String(f.id) === String(selectedFormId)) {
							var parsed = (typeof f.fields === 'string') ? JSON.parse(f.fields) : f.fields;
							formFields = [];
							if (parsed && parsed.length) {
								$.each(parsed, function(j, field) {
									var enabled = (field.enabled === true || field.enabled === '1' || field.enabled === 1 || field.enabled === 'true');
									if (enabled) {
										formFields.push(field);
									}
								});
							}
							return false;
						}
					});
				}

				window.chatPilotPlaygroundActiveFields = formFields;
				var isSubmitted = (sessionStorage.getItem('cp_play_submitted_' + playSessionId + '_' + selectedFormId) === '1');

				if (formFields.length > 0 && !isSubmitted) {
					$('#cp-play-messages').hide();
					$('.cp-playground-container .cp-grid-main .cp-card > div:nth-child(3)').hide();
					$('#cp-play-input-form').parent().hide();
					
					var $fieldsCont = $('#cp-play-prechat-fields').empty();
					$('#cp-play-prechat-error').hide().empty();

					$.each(formFields, function(i, field) {
						var isReq = (field.required === true || field.required === '1' || field.required === 1 || field.required === 'true');
						var isReqStar = isReq ? ' <span style="color:#ef4444;">*</span>' : '';
						var label = escapeHtml(field.label);
						var placeholder = escapeHtml(field.placeholder || '');
						var fid = escapeHtml(field.id);

						var fieldHtml = '';
						if (field.type === 'checkbox') {
							fieldHtml = '<div style="display:flex; align-items:center; gap:0.5rem;">' +
								'<input type="checkbox" id="cp-play-field-' + fid + '" class="cp-play-input-field" value="1" style="margin:0; width:16px; height:16px; cursor:pointer;">' +
								'<label for="cp-play-field-' + fid + '" style="font-size:0.85rem; color:#cbd5e1; font-weight:normal; cursor:pointer;">' + label + isReqStar + '</label>' +
							'</div>';
						} else {
							fieldHtml = '<div style="display:flex; flex-direction:column; gap:0.35rem;">' +
								'<label for="cp-play-field-' + fid + '" style="font-size:0.85rem; font-weight:600; color:#ffffff;">' + label + isReqStar + '</label>';

							if (field.type === 'textarea' || field.type === 'message') {
								fieldHtml += '<textarea id="cp-play-field-' + fid + '" class="cp-input cp-play-input-field" style="min-height:70px; resize:vertical;" placeholder="' + placeholder + '"></textarea>';
							} else if (field.type === 'dropdown' || field.type === 'select') {
								var options = (field.options || '').split('\n').filter(Boolean);
								fieldHtml += '<select id="cp-play-field-' + fid + '" class="cp-input cp-play-input-field" style="height:38px; background:rgba(30,41,59,0.8); color:#ffffff;">';
								fieldHtml += '<option value="">— Select Option —</option>';
								$.each(options, function(idx, opt) {
									fieldHtml += '<option value="' + escapeHtml(opt.trim()) + '">' + escapeHtml(opt.trim()) + '</option>';
								});
								fieldHtml += '</select>';
							} else if (field.type === 'radio') {
								var radioOpts = (field.options || '').split('\n').filter(Boolean);
								fieldHtml += '<div style="display:flex; flex-direction:column; gap:0.35rem; margin-top:0.25rem;">';
								$.each(radioOpts, function(idx, opt) {
									fieldHtml += '<label style="display:flex; align-items:center; gap:0.5rem; font-size:0.85rem; font-weight:normal; color:#cbd5e1; cursor:pointer;">';
									fieldHtml += '<input type="radio" name="cp-play-radio-' + fid + '" class="cp-play-input-field" value="' + escapeHtml(opt.trim()) + '" style="margin:0; width:16px; height:16px;">';
									fieldHtml += escapeHtml(opt.trim());
									fieldHtml += '</label>';
								});
								fieldHtml += '</div>';
							} else {
								var inputType = (field.type === 'email') ? 'email' : 'text';
								fieldHtml += '<input type="' + inputType + '" id="cp-play-field-' + fid + '" class="cp-input cp-play-input-field" placeholder="' + placeholder + '">';
							}
							fieldHtml += '</div>';
						}
						$fieldsCont.append(fieldHtml);
					});

					$('#cp-play-prechat-panel').fadeIn(200);
				} else {
					$('#cp-play-prechat-panel').hide();
					$('#cp-play-messages').show();
					$('.cp-playground-container .cp-grid-main .cp-card > div:nth-child(3)').show();
					$('#cp-play-input-form').parent().show();
				}
			}

			initPlaygroundPrechat();

			$('#cp-play-form-selector').on('change', function() {
				$(this).data('user-changed', true);
				playSessionId = 'cp_play_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
				localStorage.setItem('cp_play_session_id', playSessionId);
				initPlaygroundPrechat();
			});

			// Pre-chat submit inside Developer Chat Preview
			$('#cp-play-prechat-submit').on('click', function(e) {
				e.preventDefault();
				// Generate fresh unique session ID for this specific pre-chat submission session
				playSessionId = 'cp_play_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
				localStorage.setItem('cp_play_session_id', playSessionId);

				var formFields = window.chatPilotPlaygroundActiveFields || chatPilotAdmin.formFields || [];
				var activeFormId = $('#cp-play-form-selector').val() || chatPilotAdmin.formId || 1;
				var fieldsData = {};
				var hasErrors = false;
				var errorMessages = [];
				var $errorCont = $('#cp-play-prechat-error');
				$errorCont.hide().empty();

				$.each(formFields, function(i, field) {
					var fid = field.id;
					var val = '';

					if (field.type === 'checkbox') {
						val = $('#cp-play-field-' + fid).is(':checked') ? '1' : '';
					} else if (field.type === 'radio') {
						val = $('input[name="cp-play-radio-' + fid + '"]:checked').val() || '';
					} else {
						val = $('#cp-play-field-' + fid).val() || '';
					}

					var isReq = (field.required === true || field.required === '1' || field.required === 1 || field.required === 'true');
					if (isReq && !val.trim()) {
						hasErrors = true;
						errorMessages.push('The field "' + field.label + '" is required.');
					}

					if (val.trim()) {
						if (field.type === 'email' && !/\S+@\S+\.\S+/.test(val)) {
							hasErrors = true;
							errorMessages.push('Please enter a valid email address for "' + field.label + '".');
						}
						if (field.type === 'phone') {
							var digits = val.replace(/[^0-9]/g, '');
							if (digits.length < 5) {
								hasErrors = true;
								errorMessages.push('Please enter a valid phone number for "' + field.label + '".');
							}
						}
					}

					fieldsData[fid] = val;
				});

				if (hasErrors) {
					var errHtml = '<strong>Please check the required fields:</strong><ul style="margin:5px 0 0 15px; padding:0; list-style:disc;">';
					$.each(errorMessages, function(idx, msg) {
						errHtml += '<li>' + escapeHtml(msg) + '</li>';
					});
					errHtml += '</ul>';
					$errorCont.html(errHtml).slideDown(150);
					return;
				}

				var $btn = $(this);
				$btn.prop('disabled', true).text('Submitting...');

				$.ajax({
					url: chatPilotAdmin.ajaxUrl,
					type: 'POST',
					data: {
						action: 'chat_pilot_submit_prechat_form',
						form_id: activeFormId,
						fields: fieldsData,
						session_id: playSessionId,
						page_url: window.location.href,
						_wpnonce: chatPilotAdmin.widgetNonce || chatPilotAdmin.securityNonce
					},
					dataType: 'json',
					success: function(response) {
						if (response.success) {
							if (fieldsData.name) localStorage.setItem('cp_play_visitor_name', fieldsData.name);
							if (fieldsData.email) localStorage.setItem('cp_play_visitor_email', fieldsData.email);
							if (fieldsData.phone) localStorage.setItem('cp_play_visitor_phone', fieldsData.phone);
							sessionStorage.setItem('cp_play_submitted_' + playSessionId + '_' + activeFormId, '1');

							$('#cp-play-prechat-panel').fadeOut(200, function() {
								$('#cp-play-messages').fadeIn(200);
								$('.cp-playground-container .cp-grid-main .cp-card > div:nth-child(3)').fadeIn(200);
								$('#cp-play-input-form').parent().fadeIn(200);
								$('#cp-play-input-field').focus();
							});
						} else {
							$errorCont.text(response.data.message || 'Submission failed.').slideDown(150);
						}
					},
					error: function() {
						$errorCont.text('Network connection error.').slideDown(150);
					},
					complete: function() {
						$btn.prop('disabled', false).text('Start Chat');
					}
				});
			});

			// Collapsible Live Context Panels toggles
			$container.on('click', '.cp-context-toggle', function() {
				var $toggle = $(this);
				var $panel = $toggle.next('textarea');
				var $icon = $toggle.find('span:last');
				
				if ($panel.is(':visible')) {
					$panel.slideUp(150);
					$icon.text('▼');
				} else {
					$panel.slideDown(150);
					$icon.text('▲');
				}
			});

			// Developer Mode Collapsible toggle switch
			$('#cp-playground-dev-mode').on('change', function() {
				var isChecked = $(this).is(':checked');
				var $panel = $('#cp-playground-debug-panel');
				if (isChecked) {
					$panel.fadeIn(200);
					$playgroundContainer.css('grid-template-columns', '1fr 360px');
				} else {
					$panel.fadeOut(200);
					$playgroundContainer.css('grid-template-columns', '1fr');
				}
			});

			// Clear Chat Trigger
			$('#cp-play-clear').on('click', function() {
				localStorage.removeItem('cp_play_visitor_name');
				localStorage.removeItem('cp_play_visitor_email');
				localStorage.removeItem('cp_play_visitor_phone');
				sessionStorage.clear();
				playSessionId = 'cp_play_sess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
				localStorage.setItem('cp_play_session_id', playSessionId);

				$playMessages.empty();
				playgroundHistory = [];
				lastRetrievedDocs = [];
				lastUserMessage = '';
				debugLogCache     = [];
				$btnRegen.prop('disabled', true);
				$btnRetry.prop('disabled', true);
				
				// Reset Debug panel metrics
				$('#cp-diag-intent').text('—');
				$('#cp-db-confidence-badge').text('—').css({ 'background': '', 'color': '' });
				$('#cp-db-similarity').text('—');
				$('#cp-db-threshold').text('—');
				$('#cp-db-sources-used').text('—');
				$('#cp-llm-provider').text('—');
				$('#cp-llm-model').text('—');
				$('#cp-llm-latency').text('—');
				$('#cp-llm-tokens').text('—');

				// Reset sizes
				$('#cp-size-context').text('—');
				$('#cp-size-prompt').text('—');
				$('#cp-size-completion').text('—');

				// Reset flow indicators
				resetPriorityFlowchart();

				// Reset checklist
				$('#src-chk-faq, #src-chk-manual, #src-chk-file, #src-chk-website').css('color', 'var(--text-muted)').text(function(i, txt) {
					return txt.replace('✓', '☐');
				});

				// Reset Context Textareas
				$('#cp-view-faq, #cp-view-manual, #cp-view-website, #cp-view-file, #cp-view-instructions, #cp-view-prompt').val('');

				initPlaygroundPrechat();
			});

			// Form Message Submit
			$playForm.on('submit', function(e) {
				e.preventDefault();
				var text = $playField.val();
				if (!text.trim()) return;

				$playField.val('');
				lastUserMessage = text;
				
				// Append User Bubble
				$playMessages.append('<div style="align-self:flex-end; max-width:80%; display:flex; flex-direction:column; gap:0.25rem; align-items:flex-end; margin-bottom:0.75rem;" class="cp-play-msg cp-play-msg-user">' +
					'<div style="background:var(--accent-cyan); color:#ffffff; padding:0.75rem 1rem; border-radius:12px; border-top-right-radius:4px; font-size:0.9rem; line-height:1.5; word-break:break-word;">' +
						escapeHtml(text) +
					'</div>' +
				'</div>');
				
				scrollToBottom();
				togglePlaygroundLock(true);
				showPlaygroundTyping();

				executePlaygroundChat(text, false);
			});

			function executePlaygroundChat(queryText, isRegen) {
				var ajaxData = {
					action: 'chat_pilot_chat',
					message: queryText,
					history: playgroundHistory,
					session_id: playSessionId,
					visitor_name: localStorage.getItem('cp_play_visitor_name') || '',
					visitor_email: localStorage.getItem('cp_play_visitor_email') || '',
					visitor_phone: localStorage.getItem('cp_play_visitor_phone') || '',
					_wpnonce: chatPilotAdmin.widgetNonce || chatPilotAdmin.securityNonce
				};

				if (isRegen) {
					ajaxData.regenerate = 1;
					ajaxData.last_documents = lastRetrievedDocs;
				}

				$.ajax({
					url: chatPilotAdmin.ajaxUrl,
					type: 'POST',
					data: ajaxData,
					dataType: 'json',
					success: function(response) {
						removePlaygroundTyping();
						if (response.success && response.data.text) {
							var botText = response.data.text;
							var d = response.data;
							var isProviderErr = (d.metrics && d.metrics.is_provider_error) || (d.debug && d.debug.is_provider_error);

							if (isProviderErr) {
								var errLabel   = (d.metrics && d.metrics.error_label) || 'Quota / Rate Limit Exceeded';
								var errType    = (d.metrics && d.metrics.error_type) || 'quota_exceeded';
								var provName   = (d.metrics && d.metrics.provider) || 'Google Gemini';
								var modelName  = (d.metrics && d.metrics.model) || 'N/A';
								var httpCode   = (d.metrics && d.metrics.http_code) ? d.metrics.http_code : (d.debug && d.debug.http_code ? d.debug.http_code : 429);
								var latencyMs  = (d.metrics && d.metrics.latency) ? d.metrics.latency : 0;
								var retryAfter = (d.metrics && d.metrics.retry_after) ? d.metrics.retry_after : (d.debug && d.debug.retry_after ? d.debug.retry_after : '');
								var errMsg     = (d.metrics && d.metrics.error) ? d.metrics.error : (d.debug && d.debug.error ? d.debug.error : botText);
								var timeStr    = (d.debug && d.debug.timestamp) ? d.debug.timestamp : new Date().toLocaleString();

								renderPlaygroundProviderDiagnostic({
									provider: provName,
									model: modelName,
									label: errLabel,
									error_type: errType,
									http_code: httpCode,
									latency: latencyMs,
									retry_after: retryAfter,
									message: errMsg,
									timestamp: timeStr,
									fallback: botText
								});

								playgroundHistory.push({ role: 'user', content: queryText });
								playgroundHistory.push({ role: 'assistant', content: '[AI Provider Failure: ' + errLabel + ']' });

								$btnRegen.prop('disabled', false);
								$btnRetry.prop('disabled', false);
							} else {
								if (!isRegen) {
									lastRetrievedDocs = response.data.documents || [];
								}

								streamPlaygroundResponse(botText);

								// Save user + assistant response inside local state history arrays
								playgroundHistory.push({ role: 'user', content: queryText });
								playgroundHistory.push({ role: 'assistant', content: botText });

								$btnRegen.prop('disabled', false);
								$btnRetry.prop('disabled', false);
							}

							// Update diagnostics panels metrics labels
							if (response.data.debug) {
								var debug = response.data.debug;
								
								// Cache debug logs
								debugLogCache.push({
									timestamp: new Date().toLocaleString(),
									user_prompt: queryText,
									retrieved_documents: lastRetrievedDocs,
									debug_metrics: debug
								});

								// Update Intent & general
								$('#cp-diag-intent').text(debug.intent);
								$('#cp-db-similarity').text(debug.similarity_score.toFixed(4));
								$('#cp-db-threshold').text(debug.threshold.toFixed(2));
								$('#cp-db-sources-used').text(debug.sources_used);
								$('#cp-llm-provider').text(debug.provider);
								$('#cp-llm-model').text(debug.model);
								$('#cp-llm-latency').text(debug.latency + ' ms');
								$('#cp-llm-tokens').text(debug.tokens ? debug.tokens + ' tokens' : 'N/A');

								if (debug.error) {
									$('#cp-llm-error').text(debug.error);
									$('#cp-llm-error-row').show();
								} else {
									$('#cp-llm-error').text('—');
									$('#cp-llm-error-row').hide();
								}

								// Update sizes
								$('#cp-size-context').text(debug.context_size + ' bytes');
								$('#cp-size-prompt').text(debug.prompt_size + ' bytes');
								$('#cp-size-completion').text(debug.completion_size + ' bytes');

								// Update Confidence Badge
								updateConfidenceBadge(debug.confidence_status);

								// Update Priority Indicators
								updatePriorityFlowchart(debug.selected_source);

								// Update retrieved checklists
								updateChecklistSources(debug.retrieved_sources);

								// Update Context Viewer textareas
								populateLiveContextViewer(debug);
							}
						} else {
							var err = response.data.message || 'Error occurred during completions.';
							appendPlaygroundBotBubble(err);
							togglePlaygroundLock(false);
						}
					},
					error: function() {
						removePlaygroundTyping();
						appendPlaygroundBotBubble('System network connection failed.');
						togglePlaygroundLock(false);
					}
				});
			}

			function renderPlaygroundProviderDiagnostic(diag) {
				var isQuota = (diag.error_type === 'quota_exceeded');
				var badgeBg = isQuota ? 'rgba(239,68,68,0.25)' : 'rgba(245,158,11,0.25)';
				var badgeColor = isQuota ? '#fca5a5' : '#fcd34d';

				var html = '<div style="align-self:flex-start; max-width:92%; margin-bottom:0.75rem; width:100%;" class="cp-play-msg cp-play-msg-bot">' +
					'<div style="background:rgba(239,68,68,0.08); border:1px solid rgba(239,68,68,0.3); border-radius:12px; border-top-left-radius:4px; padding:1rem 1.15rem; color:#f87171; line-height:1.5; font-size:0.85rem;">' +
						'<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.65rem; border-bottom:1px solid rgba(239,68,68,0.2); padding-bottom:0.5rem; flex-wrap:wrap; gap:0.5rem;">' +
							'<span style="font-weight:700; color:#ef4444; display:flex; align-items:center; gap:0.4rem; font-size:0.92rem;">' +
								'⚠️ AI Provider Generation Failure' +
							'</span>' +
							'<span style="font-size:0.72rem; background:' + badgeBg + '; color:' + badgeColor + '; padding:2px 8px; border-radius:4px; font-weight:700; text-transform:uppercase;">' +
								escapeHtml(diag.label) +
							'</span>' +
						'</div>' +
						'<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(140px, 1fr)); gap:0.5rem; font-size:0.78rem; color:#cbd5e1; margin-bottom:0.75rem; background:rgba(0,0,0,0.25); padding:0.6rem 0.75rem; border-radius:6px;">' +
							'<div><strong>Provider:</strong> ' + escapeHtml(diag.provider) + '</div>' +
							'<div><strong>Model:</strong> ' + escapeHtml(diag.model) + '</div>' +
							'<div><strong>HTTP Status:</strong> ' + escapeHtml(String(diag.http_code || '429')) + '</div>' +
							'<div><strong>Latency:</strong> ' + escapeHtml(String(diag.latency)) + ' ms</div>' +
							'<div><strong>Error Type:</strong> ' + escapeHtml(diag.error_type) + '</div>' +
							(diag.retry_after ? '<div><strong>Retry-After:</strong> ' + escapeHtml(diag.retry_after) + '</div>' : '') +
							'<div><strong>Timestamp:</strong> ' + escapeHtml(diag.timestamp) + '</div>' +
						'</div>' +
						'<div style="font-size:0.78rem; font-weight:600; color:#fca5a5; margin-bottom:0.25rem;">Provider Error Message:</div>' +
						'<div style="background:rgba(0,0,0,0.4); border-radius:6px; padding:0.6rem 0.8rem; font-family:monospace; font-size:0.78rem; color:#fca5a5; word-break:break-word; border:1px solid rgba(239,68,68,0.15); margin-bottom:0.6rem;">' +
							escapeHtml(diag.message) +
						'</div>' +
						'<div style="font-size:0.75rem; color:var(--text-muted); font-style:italic; display:flex; align-items:center; gap:0.4rem;">' +
							'<span>ℹ️</span> <span>Frontend visitors safely receive fallback: <em>"' + escapeHtml(diag.fallback || "I'm having trouble generating a response right now. Please try again in a moment.") + '"</em></span>' +
						'</div>' +
					'</div>' +
				'</div>';

				$playMessages.append(html);
				scrollToBottom();
				togglePlaygroundLock(false);
			}

			function streamPlaygroundResponse(text) {
				var $msgDiv = $('<div style="align-self:flex-start; max-width:85%; display:flex; flex-direction:column; gap:0.25rem; margin-bottom:0.75rem;" class="cp-play-msg cp-play-msg-bot">' +
					'<div style="background:rgba(30,41,59,0.8); border:1px solid rgba(255,255,255,0.05); color:#e2e8f0; padding:0.75rem 1rem; border-radius:12px; border-top-left-radius:4px; font-size:0.9rem; line-height:1.5; word-break:break-word; display:flex; justify-content:space-between; align-items:start; gap:0.75rem;">' +
						'<div class="cp-bubble-text" style="flex-grow:1;"></div>' +
						'<button type="button" class="cp-play-copy-btn" style="background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:0.8rem; padding:2px; margin-top:2px;" title="Copy response">📋</button>' +
					'</div>' +
				'</div>');
				
				$playMessages.append($msgDiv);
				var $bubble = $msgDiv.find('.cp-bubble-text');
				
				if (text.length <= 150) {
					$bubble.html(escapeHtml(text).replace(/\n/g, '<br>').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>'));
					scrollToBottom();
					togglePlaygroundLock(false);
					return;
				}

				var charIdx = 0;
				var chunkSize = Math.max(3, Math.ceil(text.length / 45));
				var timer = setInterval(function() {
					if (charIdx < text.length) {
						charIdx = Math.min(text.length, charIdx + chunkSize);
						$bubble.html(escapeHtml(text.substring(0, charIdx)).replace(/\n/g, '<br>').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>'));
						scrollToBottom();
					} else {
						clearInterval(timer);
						togglePlaygroundLock(false);
					}
				}, 12);
			}

			function appendPlaygroundBotBubble(text) {
				var html = '<div style="align-self:flex-start; max-width:85%; display:flex; flex-direction:column; gap:0.25rem; margin-bottom:0.75rem;" class="cp-play-msg cp-play-msg-bot">' +
					'<div style="background:rgba(30,41,59,0.8); border:1px solid rgba(255,255,255,0.05); color:#e2e8f0; padding:0.75rem 1rem; border-radius:12px; border-top-left-radius:4px; font-size:0.9rem; line-height:1.5; word-break:break-word; display:flex; justify-content:space-between; align-items:start; gap:0.75rem;">' +
						'<div class="cp-bubble-text" style="flex-grow:1;">' + escapeHtml(text).replace(/\n/g, '<br>').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') + '</div>' +
						'<button type="button" class="cp-play-copy-btn" style="background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:0.8rem; padding:2px; margin-top:2px;" title="Copy response">📋</button>' +
					'</div>' +
				'</div>';
				$playMessages.append(html);
				scrollToBottom();
			}

			// Copy bubble text action
			$container.on('click', '.cp-play-copy-btn', function() {
				var $btn = $(this);
				var bubbleText = $btn.siblings('.cp-bubble-text').text();
				
				var $temp = $('<textarea>');
				$('body').append($temp);
				$temp.val(bubbleText).select();
				document.execCommand('copy');
				$temp.remove();

				$btn.text('✅');
				setTimeout(function() {
					$btn.text('📋');
				}, 1500);
			});

			// Export Debug logs
			$('#cp-play-export-log').on('click', function() {
				if (!debugLogCache.length) {
					alert('No messages to export yet.');
					return;
				}
				var fileContent = JSON.stringify(debugLogCache, null, 4);
				var blob = new Blob([fileContent], { type: 'application/json' });
				var link = document.createElement('a');
				link.href = URL.createObjectURL(blob);
				link.download = 'chat-pilot-playground-debug-' + Date.now() + '.json';
				document.body.appendChild(link);
				link.click();
				document.body.removeChild(link);
			});

			function showPlaygroundTyping() {
				$playMessages.append('<div id="cp-play-typing" style="align-self:flex-start; max-width:85%; display:flex; gap:0.5rem; margin-bottom:0.75rem;" class="cp-play-msg cp-play-msg-bot">' +
					'<div style="background:rgba(30,41,59,0.8); border:1px solid rgba(255,255,255,0.05); padding:0.75rem 1rem; border-radius:12px; border-top-left-radius:4px;">' +
						'<div class="cp-typing-indicator">' +
							'<div class="cp-typing-dot"></div>' +
							'<div class="cp-typing-dot"></div>' +
							'<div class="cp-typing-dot"></div>' +
						'</div>' +
					'</div>' +
				'</div>');
				scrollToBottom();
			}

			function removePlaygroundTyping() {
				$('#cp-play-typing').remove();
			}

			function togglePlaygroundLock(lock) {
				$playField.prop('disabled', lock);
				$sendBtn.prop('disabled', lock);
				if (!lock) {
					$playField.focus();
				}
			}

			function scrollToBottom() {
				$playMessages.scrollTop($playMessages[0].scrollHeight);
			}

			function updateConfidenceBadge(status) {
				var $badge = $('#cp-db-confidence-badge').text(status);
				var bg = '', col = '';
				
				if (status === 'Excellent Match') {
					bg = 'rgba(34,197,94,0.15)'; col = 'var(--accent-green)';
				} else if (status === 'Good Match') {
					bg = 'rgba(6,182,212,0.15)'; col = 'var(--accent-cyan)';
				} else if (status === 'Weak Match') {
					bg = 'rgba(249,115,22,0.15)'; col = 'var(--accent-orange)';
				} else if (status === 'Fallback') {
					bg = 'rgba(239,68,68,0.15)'; col = '#f87171';
				} else {
					bg = 'rgba(255,255,255,0.05)'; col = '#cbd5e1';
				}
				$badge.css({ 'background': bg, 'color': col });
			}

			function resetPriorityFlowchart() {
				$('#flow-faq, #flow-manual, #flow-file, #flow-website').css({
					'background': '', 'border-color': '', 'color': '', 'box-shadow': ''
				});
			}

			function updatePriorityFlowchart(selected) {
				resetPriorityFlowchart();
				if (!selected || selected === 'none') return;
				
				var elementId = '';
				var activeCol = '';
				var shadowCol = '';
				
				if (selected === 'faq') {
					elementId = '#flow-faq'; activeCol = 'var(--accent-cyan)'; shadowCol = 'rgba(6,182,212,0.25)';
				} else if (selected === 'manual') {
					elementId = '#flow-manual'; activeCol = 'var(--accent-purple)'; shadowCol = 'rgba(168,85,247,0.25)';
				} else if (selected === 'file') {
					elementId = '#flow-file'; activeCol = 'var(--accent-orange)'; shadowCol = 'rgba(249,115,22,0.25)';
				} else if (selected === 'website') {
					elementId = '#flow-website'; activeCol = 'var(--accent-green)'; shadowCol = 'rgba(34,197,94,0.25)';
				}

				if (elementId) {
					$(elementId).css({
						'background': 'rgba(255,255,255,0.02)',
						'border-color': activeCol,
						'color': activeCol,
						'box-shadow': '0 0 10px ' + shadowCol
					});
				}
			}

			function updateChecklistSources(retrieved) {
				if (!retrieved) return;
				
				var keys = ['faq', 'manual', 'file', 'website'];
				$.each(keys, function(i, key) {
					var $el = $('#src-chk-' + key);
					var checked = retrieved[key];
					
					if (checked) {
						$el.css('color', 'var(--accent-green)').text('✓ ' + capitalizeFirst(key === 'file' ? 'File' : key));
					} else {
						$el.css('color', 'var(--text-muted)').text('☐ ' + capitalizeFirst(key === 'file' ? 'File' : key));
					}
				});
			}

			function capitalizeFirst(txt) {
				return txt.charAt(0).toUpperCase() + txt.slice(1);
			}

			function populateLiveContextViewer(debug) {
				// Segregate source documents texts
				var faqTxt = '', manTxt = '', webTxt = '', docTxt = '';
				
				if (lastRetrievedDocs && lastRetrievedDocs.length) {
					$.each(lastRetrievedDocs, function(i, doc) {
						var formatted = 'Title: ' + doc.title + '\nRelevance: ' + doc.relevance_score.toFixed(4) + '\nContent:\n' + doc.content + '\n\n---\n\n';
						if (doc.source_type === 'faq') {
							faqTxt += formatted;
						} else if (doc.source_type === 'manual') {
							manTxt += formatted;
						} else if (doc.source_type === 'website') {
							webTxt += formatted;
						} else if (doc.source_type === 'file') {
							docTxt += formatted;
						}
					});
				}

				$('#cp-view-faq').val(faqTxt || 'No FAQ context matched.');
				$('#cp-view-manual').val(manTxt || 'No Manual knowledge context matched.');
				$('#cp-view-website').val(webTxt || 'No Website Scanner context matched.');
				$('#cp-view-file').val(docTxt || 'No Uploaded Documents context matched.');
				
				// Populate merge prompt and directives
				$('#cp-view-prompt').val(debug.raw_prompt || 'No merged prompt text generated.');
				$('#cp-view-instructions').val(chatPilotAdmin.systemPrompt || 'No active directives loaded.');
			}

			// Regenerate Trigger
			$btnRegen.on('click', function() {
				if ($playField.is(':disabled') || !lastUserMessage) return;
				
				// Pop the last assistant reply and last user query from history
				if (playgroundHistory.length >= 2) {
					playgroundHistory.pop();
					playgroundHistory.pop();
				}
				
				// Remove last visual bubble
				$playMessages.find('.cp-play-msg-bot:last').remove();
				
				togglePlaygroundLock(true);
				showPlaygroundTyping();
				
				// Call execution forcing cached regeneration mode
				executePlaygroundChat(lastUserMessage, true);
			});

			// Retry Trigger
			$btnRetry.on('click', function() {
				if (!lastUserMessage) return;
				$playField.val(lastUserMessage).focus();
			});
		}

		// 8.1. AI Instructions Form binding
		var $instructionsForm = $('#cp-instructions-form');
		if ($instructionsForm.length) {
			var $instProviderSelect = $('#instructions_provider');
			var $instModelSelect = $('#instructions_model');
			var $instSubmitBtn = $instructionsForm.find('button[type="submit"]');

			$instProviderSelect.on('change', function() {
				var slug = $(this).val();
				$instModelSelect.empty();

				var modelsList = (slug && window.chatPilotInstructionsModels && window.chatPilotInstructionsModels[slug]) ? window.chatPilotInstructionsModels[slug] : [];
				if (!slug) {
					$instModelSelect.append($('<option></option>').val('').text('— Select Active Provider First —')).prop('disabled', true);
					return;
				}

				if (modelsList && modelsList.length > 0) {
					$instModelSelect.append($('<option></option>').val('').text('— Select Discovered Model —'));
					var isSelectedFound = false;

					$.each(modelsList, function(i, val) {
						var formattedLabel = val;
						if (val.indexOf('antigravity') !== -1) {
							formattedLabel = val + ' (Interactions API Only)';
						} else if (val.indexOf('deep-research') !== -1) {
							formattedLabel = val + ' (Deep Research Only)';
						}
						var $opt = $('<option></option>').val(val).text(formattedLabel);
						if (val === window.chatPilotInstructionsSelectedModel) {
							$opt.prop('selected', true);
							isSelectedFound = true;
						}
						$instModelSelect.append($opt);
					});

					// If previously saved model for this provider is no longer in discovered list, flag as stale
					if (window.chatPilotInstructionsSelectedModel && !isSelectedFound) {
						var $staleOpt = $('<option></option>')
							.val(window.chatPilotInstructionsSelectedModel)
							.text('[Stale/Invalid Model: ' + window.chatPilotInstructionsSelectedModel + '] — Please select a valid model')
							.prop('selected', true)
							.css('color', '#ef4444');
						$instModelSelect.prepend($staleOpt);
					}

					$instModelSelect.prop('disabled', false);
				} else {
					$instModelSelect.append($('<option></option>').val('').text('— Run connection test in AI Providers to discover models —')).prop('disabled', true);
				}
			});

			// Trigger load trigger to prefill defaults
			if ($instProviderSelect.val()) {
				$instProviderSelect.trigger('change');
			}

			$instructionsForm.on('submit', function(e) {
				e.preventDefault();
				var originalBtnHtml = $instSubmitBtn.html();
				$instSubmitBtn.prop('disabled', true).html('<span class="spinner is-active" style="float:none; margin:0 5px 0 0;"></span> Saving...');

				$.ajax({
					url: chatPilotAdmin.ajaxUrl,
					type: 'POST',
					data: {
						action: 'chat_pilot_save_instructions',
						default_provider: $instProviderSelect.val(),
						default_model: $instModelSelect.val(),
						system_prompt: $('#instructions_system_prompt').val(),
						fallback_response: $('#instructions_fallback').val(),
						_wpnonce: chatPilotAdmin.securityNonce
					},
					dataType: 'json',
					success: function(response) {
						if (response.success) {
							showNotification(response.data.message, 'success');
							window.chatPilotInstructionsSelectedModel = $instModelSelect.val();
						} else {
							showNotification(response.data.message || 'Save failed.', 'error');
						}
					},
					error: function() {
						showNotification('System connection error while saving directives.', 'error');
					},
					complete: function() {
						$instSubmitBtn.prop('disabled', false).html(originalBtnHtml);
					}
				});
			});
		}

		// 8.2. Chat Widget Settings Form binding
		var $widgetForm = $('#cp-widget-settings-form');
		if ($widgetForm.length) {
			var $widgetSubmitBtn = $widgetForm.find('button[type="submit"]');

			// Auto Open toggle show/hide container listener
			$('#widget_auto_open_chat').on('change', function() {
				var isChecked = $(this).is(':checked');
				if (isChecked) {
					$('#widget_delay_group, #widget_once_group').slideDown(150);
				} else {
					$('#widget_delay_group, #widget_once_group').slideUp(150);
				}
			});

			$widgetForm.on('submit', function(e) {
				e.preventDefault();
				var originalBtnHtml = $widgetSubmitBtn.html();
				$widgetSubmitBtn.prop('disabled', true).html('<span class="spinner is-active" style="float:none; margin:0 5px 0 0;"></span> Saving...');

				var data = {
					action: 'chat_pilot_save_widget_settings',
					enable_widget: $widgetForm.find('input[name="enable_widget"]').is(':checked') ? 1 : 0,
					position: $('#widget_position').val(),
					primary_color: $('#widget_color').val(),
					welcome_message: $('#widget_welcome').val(),
					placeholder_text: $('#widget_placeholder').val(),
					suggested_questions: $('#widget_suggestions').val(),
					logo_url: $('#widget_logo').val(),
					collect_name: $widgetForm.find('input[name="collect_name"]').is(':checked') ? 1 : 0,
					collect_email: $widgetForm.find('input[name="collect_email"]').is(':checked') ? 1 : 0,
					collect_phone: $widgetForm.find('input[name="collect_phone"]').is(':checked') ? 1 : 0,
					enable_typing: $widgetForm.find('input[name="enable_typing"]').is(':checked') ? 1 : 0,
					enable_streaming: $widgetForm.find('input[name="enable_streaming"]').is(':checked') ? 1 : 0,
					auto_open_chat: $('#widget_auto_open_chat').is(':checked') ? 1 : 0,
					open_once_per_visitor: $('#widget_open_once_per_visitor').is(':checked') ? 1 : 0,
					auto_open_delay: $('#widget_delay').val(),
					_wpnonce: chatPilotAdmin.securityNonce
				};

				$.ajax({
					url: chatPilotAdmin.ajaxUrl,
					type: 'POST',
					data: data,
					dataType: 'json',
					success: function(response) {
						if (response.success) {
							showNotification(response.data.message, 'success');
						} else {
							showNotification(response.data.message || 'Save failed.', 'error');
						}
					},
					error: function() {
						showNotification('System connection error while saving widget settings.', 'error');
					},
					complete: function() {
						$widgetSubmitBtn.prop('disabled', false).html(originalBtnHtml);
					}
				});
			});
		}

		// 9. Developer Mode Reset confirmations.
		$container.on('click', '.cp-js-dev-action', function(e) {
			e.preventDefault();
			
			var $btn = $(this);
			var actionType = $btn.data('action-type');
			var confirmMsg = $btn.data('confirm');
			
			if (confirmMsg && !confirm(confirmMsg)) {
				return;
			}
			
			var originalBtnText = $btn.text();
			$btn.prop('disabled', true).text('Processing...');
			
			$.ajax({
				url: chatPilotAdmin.ajaxUrl,
				type: 'POST',
				data: {
					action: 'chat_pilot_dev_action',
					action_type: actionType,
					_wpnonce: chatPilotAdmin.securityNonce
				},
				dataType: 'json',
				success: function(response) {
					if (response.success) {
						showNotification(response.data.message, 'success');
						if (actionType === 'clear_logs') {
							$('.cp-table tbody').html('<tr><td colspan="4" style="text-align:center;">No logs found.</td></tr>');
						} else if (actionType === 'reset_settings') {
							setTimeout(function() {
								window.location.reload();
							}, 1000);
						}
					} else {
						showNotification(response.data.message || 'Developer action failed.', 'error');
					}
				},
				error: function() {
					showNotification('Network request failed.', 'error');
				},
				complete: function() {
					$btn.prop('disabled', false).text(originalBtnText);
				}
			});
		});

		/* ==========================================================================
		   KNOWLEDGE BASE (TAB-KB) INTERACTIONS & AJAX OPERATIONS
		   ========================================================================== */

		// 1. Ingestion Cards selector & Workspace display
		$container.on('click', '.cp-ingest-card', function(e) {
			e.preventDefault();
			var $card = $(this);
			var source = $card.data('source');

			// Highlight active card
			$card.addClass('active').siblings().removeClass('active');

			// Update workspace headers
			var badgeText = 'SOURCE';
			var titleText = 'Ingestion Workspace';
			switch(source) {
				case 'website':
					badgeText = 'WEBSITE';
					titleText = 'Website URL Crawler';
					break;
				case 'file':
					badgeText = 'DOCUMENTS';
					titleText = 'Local Document Uploader';
					break;
				case 'manual':
					badgeText = 'MANUAL';
					titleText = 'Write Manual Business Entry';
					break;
				case 'faq':
					badgeText = 'FAQ';
					titleText = 'FAQ Q&A Builder';
					break;
			}
			$('#cp-kb-workspace-badge').text(badgeText);
			$('#cp-kb-workspace-title').text(titleText);

			// Toggle form content
			$('#kb-form-' + source).addClass('active').siblings('.cp-workspace-form-content').removeClass('active');

			// Reset FAQ mode to bulk paste if entering builder normally
			if (source === 'faq') {
				if (!$('#kb_faq_source_id').val()) {
					$('#cp-faq-bulk-container').show();
					$('#kb_faq_bulk_paste').prop('required', true);
					$('#cp-faq-single-container').hide();
					$('#kb_faq_question').prop('required', false);
					$('#kb_faq_answer').prop('required', false);
				}
			}

			// Slide open workspace and scroll smoothly
			var $workspace = $('#cp-kb-workspace-container');
			$workspace.slideDown(300, function() {
				$('html, body').animate({
					scrollTop: $workspace.offset().top - 120
				}, 400);
			});
		});

		// Close Workspace action
		$container.on('click', '#cp-kb-workspace-close', function(e) {
			e.preventDefault();
			$('#cp-kb-workspace-container').slideUp(250);
			$('.cp-ingest-card').removeClass('active');
			
			// Reset manual edit states
			$('#kb_manual_source_id').val('');
			$('#cp-kb-manual-form')[0].reset();
			$('#kb-manual-btn-submit').html('Save Knowledge Entry');
			
			// Reset FAQ edit states
			$('#kb_faq_source_id').val('');
			$('#cp-kb-faq-form')[0].reset();
			$('#kb-faq-btn-submit').html('Save FAQ Entry');
			
			// Reset FAQ Bulk/Single view toggles
			$('#cp-faq-bulk-container').show();
			$('#kb_faq_bulk_paste').prop('required', true);
			$('#cp-faq-single-container').hide();
			$('#kb_faq_question').prop('required', false).val('');
			$('#kb_faq_answer').prop('required', false).val('');
		});

		// 2. Collapsible developer diagnostics accordion
		$container.on('click', '#cp-kb-dev-toggle', function(e) {
			e.preventDefault();
			var $header = $(this);
			$header.toggleClass('active');
			$('#cp-kb-dev-body').slideToggle(250);
		});

		// 2. Collapsible documents lists for each source row
		$container.on('click', '.source-row', function(e) {
			// Don't toggle accordion if user clicked an action button
			if ($(e.target).closest('.cp-action-btn').length) {
				return;
			}
			var sourceId = $(this).data('id');
			$('#docs-sub-' + sourceId).toggleClass('active');
		});

		// 3. Website Crawler submission (Multi-step Verification & Progress Console)
		var crawlQueue = [];
		var crawlSourceId = 0;
		var crawlCurrentIndex = 0;
		var crawlImportedCount = 0;
		var crawlSkippedCount = 0;
		var crawlCancelFlag = false;
		var crawlStartTime = 0;
		var crawlTotalPages = 0;

		$container.on('submit', '#cp-kb-website-form', function(e) {
			e.preventDefault();
			var $form = $(this);
			var $btn = $('#cp-crawler-start-btn');
			var $spinner = $btn.find('.cp-btn-spinner');
			var originalHtml = $btn.html();

			var url = $('#kb_website_url').val();
			var maxPages = $('#kb_website_max_pages').val();

			// Reset variables
			crawlQueue = [];
			crawlSourceId = 0;
			crawlCurrentIndex = 0;
			crawlImportedCount = 0;
			crawlSkippedCount = 0;
			crawlCancelFlag = false;
			crawlStartTime = Date.now();
			crawlTotalPages = 0;

			// UI states
			$btn.prop('disabled', true);
			$spinner.show();
			$btn.html('<span class="cp-btn-spinner"></span> Initializing scan...');

			// Hide old summary/results & show progress
			$('#cp-crawler-summary-container').slideUp(200);
			$('#cp-crawler-retrieval-sidebar').slideUp(200);
			$('#cp-crawler-progress-logs').empty();
			$('#cp-crawler-progress-percent').text('0%');
			$('#cp-crawler-progress-bar-fill').css('width', '0%');
			$('#cp-crawler-progress-container').slideDown(300);

			logProgress('Connecting to Website...');

			$.ajax({
				url: chatPilotAdmin.ajaxUrl,
				type: 'POST',
				data: {
					action: 'chat_pilot_crawler_discover',
					url: url,
					max_pages: maxPages,
					_wpnonce: chatPilotAdmin.securityNonce
				},
				dataType: 'json',
				success: function(response) {
					if (response.success) {
						logProgress('✔ Connected', 'success');
						logProgress('Discovering Pages...');

						crawlSourceId = response.data.source_id;
						crawlQueue = response.data.urls;
						crawlTotalPages = crawlQueue.length;

						logProgress('✔ ' + crawlTotalPages + ' Pages Found', 'success');
						logProgress('Extracting Content...');

						// Start sequential page processing
						processNextCrawlPage($btn, originalHtml);
					} else {
						logProgress('❌ Connection failed: ' + (response.data.message || 'Unknown error'), 'error');
						showNotification(response.data.message || 'Failed to connect to website.', 'error');
						resetCrawlButton($btn, originalHtml);
					}
				},
				error: function() {
					logProgress('❌ Network handshake failure.', 'error');
					showNotification('Network connection error.', 'error');
					resetCrawlButton($btn, originalHtml);
				}
			});
		});

		function processNextCrawlPage($btn, originalHtml) {
			if (crawlCancelFlag) {
				logProgress('❌ Scan canceled by administrator.', 'error');
				showNotification('Website scan canceled.', 'warning');
				resetCrawlButton($btn, originalHtml);
				
				// Re-load the sources list so they can see the saved state
				setTimeout(function() {
					window.location.reload();
				}, 1500);
				return;
			}

			if (crawlCurrentIndex >= crawlTotalPages) {
				finalizeCrawlerSync($btn, originalHtml);
				return;
			}

			var currentUrl = crawlQueue[crawlCurrentIndex];
			var percent = Math.round((crawlCurrentIndex / crawlTotalPages) * 100);
			$('#cp-crawler-progress-percent').text(percent + '%');
			$('#cp-crawler-progress-bar-fill').css('width', percent + '%');

			logProgress('Processing Page ' + (crawlCurrentIndex + 1) + ' of ' + crawlTotalPages + ': ' + currentUrl);

			$.ajax({
				url: chatPilotAdmin.ajaxUrl,
				type: 'POST',
				data: {
					action: 'chat_pilot_crawler_process_page',
					source_id: crawlSourceId,
					url: currentUrl,
					_wpnonce: chatPilotAdmin.securityNonce
				},
				dataType: 'json',
				success: function(response) {
					if (response.success) {
						if (response.data.skipped) {
							crawlSkippedCount++;
							logProgress('  ↳ Skipped: No readable content found.', 'warning');
						} else {
							crawlImportedCount++;
							logProgress('  ↳ ✔ Parsed: ' + response.data.title + ' (' + response.data.word_count + ' words)', 'success');
						}
					} else {
						crawlSkippedCount++;
						logProgress('  ↳ ❌ Page parsing error.', 'error');
					}
					crawlCurrentIndex++;
					setTimeout(function() {
						processNextCrawlPage($btn, originalHtml);
					}, 200); // Small visual stagger delay
				},
				error: function() {
					crawlSkippedCount++;
					logProgress('  ↳ ❌ Connection lost. Skipping page.', 'error');
					crawlCurrentIndex++;
					processNextCrawlPage($btn, originalHtml);
				}
			});
		}

		function finalizeCrawlerSync($btn, originalHtml) {
			logProgress('Creating Knowledge Documents...');
			logProgress('Building Retrieval Index...');

			var duration = Math.round((Date.now() - crawlStartTime) / 1000);

			$.ajax({
				url: chatPilotAdmin.ajaxUrl,
				type: 'POST',
				data: {
					action: 'chat_pilot_crawler_finalize',
					source_id: crawlSourceId,
					duration_seconds: duration,
					discovered_count: crawlTotalPages,
					imported_count: crawlImportedCount,
					skipped_count: crawlSkippedCount,
					_wpnonce: chatPilotAdmin.securityNonce
				},
				dataType: 'json',
				success: function(response) {
					if (response.success) {
						$('#cp-crawler-progress-percent').text('100%');
						$('#cp-crawler-progress-bar-fill').css('width', '100%');
						logProgress('Completed Successfully.', 'success');

						showNotification('Website crawled and summary generated.', 'success');

						// Delay hiding progress console slightly for aesthetic smoothness
						setTimeout(function() {
							$('#cp-crawler-progress-container').slideUp(250);
							
							// Render Summary Card
							var summary = response.data.summary;
							$('#cp-summary-url').text($('#kb_website_url').val());
							$('#cp-summary-duration').text(summary.duration + ' seconds');
							$('#cp-summary-discovered').text(summary.discovered);
							$('#cp-summary-imported').text(summary.imported);
							$('#cp-summary-documents').text(summary.imported);
							$('#cp-summary-skipped').text(summary.skipped);

							// Render Clickable Pages list
							var $list = $('#cp-summary-pages-list').empty();
							var docs = response.data.documents || [];
							if (docs.length === 0) {
								$list.html('<p style="font-size:0.85rem; color:#94a3b8; padding:0.5rem; margin:0;">No documents created.</p>');
							} else {
								docs.forEach(function(d) {
									var path = d.source_url.replace(/https?:\/\/[^\/]+/i, '') || '/';
									$list.append(
										'<div class="cp-crawled-item-row" data-id="' + d.id + '" style="display:flex; align-items:center; justify-content:space-between; padding:0.65rem 0.85rem; border-bottom:1px solid rgba(255,255,255,0.03); cursor:pointer; transition:background 0.2s ease;">' +
											'<span style="font-size:0.85rem; color:#e2e8f0; font-family:\'Fira Code\', monospace;">✔ ' + path + '</span>' +
											'<span style="font-size:0.8rem; color:var(--accent-cyan); display:flex; align-items:center; gap:0.25rem;">Preview <span>👁</span></span>' +
										'</div>'
									);
								});
							}

							// Render Search Retrieval Verification block
							$('#cp-test-search-source-id').val(crawlSourceId);
							$('#cp-test-search-results').html('<span style="font-size:0.8rem; color:#94a3b8; font-style:italic; padding:0.25rem; display:block;">No search query executed yet.</span>');
							$('#cp-crawler-retrieval-sidebar').slideDown(300);

							// Slide down completion summary
							$('#cp-crawler-summary-container').slideDown(300);
							
							// Load scan history
							loadCrawlHistorySidebar($('#kb_website_url').val());
						}, 800);

					} else {
						showNotification('Failed to generate crawl summary.', 'error');
						logProgress('❌ Finalization failed: ' + response.data.message, 'error');
					}
					resetCrawlButton($btn, originalHtml);
				},
				error: function() {
					showNotification('Finalization request failed.', 'error');
					logProgress('❌ Finalization connection lost.', 'error');
					resetCrawlButton($btn, originalHtml);
				}
			});
		}

		function resetCrawlButton($btn, originalHtml) {
			$btn.html(originalHtml).prop('disabled', false);
			$btn.find('.cp-btn-spinner').hide();
		}

		function logProgress(msg, type) {
			var color = '#e2e8f0';
			if (type === 'success') color = '#4ade80';
			if (type === 'warning') color = '#fbbf24';
			if (type === 'error') color = '#f87171';

			var timestamp = new Date().toLocaleTimeString();
			var $logs = $('#cp-crawler-progress-logs');
			$logs.append('<div style="color:' + color + '; margin-bottom: 0.25rem;">[' + timestamp + '] ' + msg + '</div>');
			$logs.scrollTop($logs[0].scrollHeight);
		}

		// Cancel Crawler Action
		$container.on('click', '#cp-crawler-cancel-btn', function(e) {
			e.preventDefault();
			crawlCancelFlag = true;
			logProgress('⚠️ Canceling crawler queue...', 'warning');
		});

		// Fetch and render historical website logs inside the sidebar
		function loadCrawlHistorySidebar(url) {
			$.ajax({
				url: chatPilotAdmin.ajaxUrl,
				type: 'POST',
				data: {
					action: 'chat_pilot_get_source_history',
					url: url,
					_wpnonce: chatPilotAdmin.securityNonce
				},
				dataType: 'json',
				success: function(response) {
					var $historyCard = $('#cp-crawler-history-sidebar');
					var $list = $historyCard.find('.cp-history-list-wrapper').empty();

					if (response.success && response.data.history && response.data.history.length > 0) {
						$historyCard.slideDown(300);
						response.data.history.forEach(function(h) {
							var dateStr = new Date(h.timestamp).toLocaleDateString(undefined, {month: 'short', day: 'numeric', hour: '2-digit', minute:'2-digit'});
							$list.append(
								'<div style="padding: 0.75rem 0; border-bottom: 1px solid rgba(255,255,255,0.03); font-size: 0.85rem;">' +
									'<div style="display:flex; justify-content:space-between; color:#ffffff; font-weight:600; margin-bottom: 0.25rem;">' +
										'<span>' + h.imported + ' Pages Imported</span>' +
										'<span style="color:#4ade80;">✔ ' + h.status + '</span>' +
									'</div>' +
									'<div style="display:flex; justify-content:space-between; color:#94a3b8; font-size: 0.75rem;">' +
										'<span>' + dateStr + '</span>' +
										'<span>' + h.duration + 's</span>' +
									'</div>' +
								'</div>'
							);
						});
					} else {
						$historyCard.hide();
					}
				}
			});
		}

		// Click on crawled item page row triggers Document Preview
		$container.on('click', '.cp-crawled-item-row', function(e) {
			e.preventDefault();
			var docId = $(this).data('id');

			$.ajax({
				url: chatPilotAdmin.ajaxUrl,
				type: 'POST',
				data: {
					action: 'chat_pilot_get_document_preview',
					doc_id: docId,
					_wpnonce: chatPilotAdmin.securityNonce
				},
				dataType: 'json',
				success: function(response) {
					if (response.success) {
						$('#cp-preview-modal-title').text(response.data.title);
						$('#cp-preview-modal-body').text(response.data.content);
						$('#cp-preview-modal-url').text(response.data.url);
						$('#cp-preview-modal').css('display', 'flex').hide().fadeIn(250);
					} else {
						showNotification(response.data.message || 'Failed to load preview.', 'error');
					}
				},
				error: function() {
					showNotification('Connection error while fetching preview.', 'error');
				}
			});
		});

		// Close preview modal handlers
		$container.on('click', '#cp-preview-modal-close, #cp-preview-modal-close-btn', function(e) {
			e.preventDefault();
			$('#cp-preview-modal').fadeOut(200);
		});

		// Close preview modal when clicking outside contents
		$(document).on('click', '#cp-preview-modal', function(e) {
			if ($(e.target).hasClass('cp-modal-overlay')) {
				$('#cp-preview-modal').fadeOut(200);
			}
		});

		// Test Retrieval queries on the newly crawled source
		$container.on('submit', '#cp-crawler-test-search-form', function(e) {
			e.preventDefault();
			var sourceId = $('#cp-test-search-source-id').val();
			var query = $('#cp-test-search-query').val();
			var $results = $('#cp-test-search-results').html('<span style="font-size:0.8rem; color:#94a3b8; font-style:italic; padding:0.25rem; display:block;">Querying RAG scorer...</span>');

			$.ajax({
				url: chatPilotAdmin.ajaxUrl,
				type: 'POST',
				data: {
					action: 'chat_pilot_crawler_test_retrieval',
					source_id: sourceId,
					query: query,
					_wpnonce: chatPilotAdmin.securityNonce
				},
				dataType: 'json',
				success: function(response) {
					if (response.success && response.data.documents && response.data.documents.length > 0) {
						$results.empty();
						response.data.documents.forEach(function(d, idx) {
							$results.append(
								'<div style="padding: 0.5rem; border-bottom: 1px solid rgba(255,255,255,0.03); margin-bottom: 0.5rem;">' +
									'<div style="display:flex; justify-content:space-between; font-size: 0.85rem; font-weight:600; color:#ffffff; margin-bottom: 0.25rem;">' +
										'<span style="max-width:70%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' + (idx+1) + '. ' + d.title + '</span>' +
										'<span style="color:var(--accent-cyan); font-size:0.75rem;">Score: ' + d.relevance_score + '</span>' +
									'</div>' +
									'<p style="margin:0; font-size:0.75rem; color:#94a3b8; line-height:1.4;">' + d.content + '</p>' +
								'</div>'
							);
						});
					} else {
						$results.html('<span style="font-size:0.8rem; color:#f87171; font-style:italic; padding:0.25rem; display:block;">No relevant matching chunks found.</span>');
					}
				},
				error: function() {
					$results.html('<span style="font-size:0.8rem; color:#f87171; font-style:italic; padding:0.25rem; display:block;">Search connection failed.</span>');
				}
			});
		});

		// Trigger Rescan / Overwrite from the sources list action button
		$container.on('click', '.cp-action-rescan-website', function(e) {
			e.preventDefault();
			var $btn = $(this);
			var nameUrl = $btn.data('name');
			
			// Highlight website card and slide open the panel
			$('.cp-ingest-card[data-source="website"]').trigger('click');
			
			// Auto fill URL field and trigger start
			$('#kb_website_url').val(nameUrl);
			$('#cp-kb-website-form').submit();
		});

		// 4. File Drag and Drop file parsing
		var $dragZone = $('#cp-file-drag-zone');
		if ($dragZone.length) {
			$dragZone.on('dragover dragenter', function(e) {
				e.preventDefault();
				$dragZone.addClass('dragover');
			});

			$dragZone.on('dragleave drop', function(e) {
				e.preventDefault();
				$dragZone.removeClass('dragover');
			});

			$dragZone.on('drop', function(e) {
				var files = e.originalEvent.dataTransfer.files;
				if (files.length) {
					handleFileUpload(files[0]);
				}
			});

			$container.on('change', '#kb_file_select', function(e) {
				if (this.files.length) {
					handleFileUpload(this.files[0]);
				}
			});
		}

		function handleFileUpload(file) {
			var ext = file.name.split('.').pop().toLowerCase();
			if (['pdf', 'docx', 'txt'].indexOf(ext) === -1) {
				showNotification('Unsupported file type. Only PDF, DOCX, and TXT are supported.', 'error');
				return;
			}

			var $statusBlock = $('#cp-file-upload-status');
			var $progressBar = $statusBlock.find('.cp-progress-fill');
			var $statusMsg = $statusBlock.find('.status-msg');

			$statusBlock.show();
			$progressBar.css('width', '10%');
			$statusMsg.text('Uploading ' + file.name + '...');

			var formData = new FormData();
			formData.append('kb_file', file);
			formData.append('action', 'chat_pilot_upload_kb_file');
			formData.append('_wpnonce', chatPilotAdmin.securityNonce);

			$.ajax({
				url: chatPilotAdmin.ajaxUrl,
				type: 'POST',
				data: formData,
				contentType: false,
				processData: false,
				xhr: function() {
					var myXhr = $.ajaxSettings.xhr();
					if (myXhr.upload) {
						myXhr.upload.addEventListener('progress', function(e) {
							if (e.lengthComputable) {
								var max = e.total;
								var current = e.loaded;
								var percentage = Math.round((current * 100) / max);
								// Keep 90% until server responds with parsed success
								$progressBar.css('width', Math.min(percentage, 90) + '%');
							}
						}, false);
					}
					return myXhr;
				},
				success: function(response) {
					if (response.success) {
						$progressBar.css('width', '100%');
						$statusMsg.text('Parsing complete!');
						showNotification(response.data.message, 'success');
						setTimeout(function() {
							window.location.reload();
						}, 1200);
					} else {
						$statusBlock.hide();
						showNotification(response.data.message || 'File upload parsing failed.', 'error');
					}
				},
				error: function() {
					$statusBlock.hide();
					showNotification('Connection error while uploading file.', 'error');
				}
			});
		}

		// 5. Manual Knowledge save/edit
		$container.on('submit', '#cp-kb-manual-form', function(e) {
			e.preventDefault();
			var $form = $(this);
			var $btn = $('#kb-manual-btn-submit');
			var $spinner = $btn.find('.cp-btn-spinner');

			$btn.prop('disabled', true);
			$spinner.show();

			var formData = $form.serializeArray();
			formData.push({ name: 'action', value: 'chat_pilot_save_kb_manual' });

			$.ajax({
				url: chatPilotAdmin.ajaxUrl,
				type: 'POST',
				data: formData,
				dataType: 'json',
				success: function(response) {
					if (response.success) {
						showNotification(response.data.message, 'success');
						setTimeout(function() {
							window.location.reload();
						}, 1200);
					} else {
						showNotification(response.data.message || 'Manual entry save failed.', 'error');
					}
				},
				error: function() {
					showNotification('Connection error while saving entry.', 'error');
				},
				complete: function() {
					$btn.prop('disabled', false);
					$spinner.hide();
				}
			});
		});

		// Edit Manual handler
		$container.on('click', '.cp-action-edit-manual', function(e) {
			e.preventDefault();
			var $btn = $(this);
			
			// Fill manual form
			$('#kb_manual_source_id').val($btn.data('id'));
			$('#kb_manual_title').val($btn.data('title'));
			$('#kb_manual_content').val($btn.data('content'));
			$('#kb_manual_category').val($btn.data('category'));
			$('#kb_manual_tags').val($btn.data('tags'));

			// Update buttons
			$('#kb-manual-btn-submit').html('🔄 Update Knowledge Entry');

			// Trigger manual onboarding card click
			$('.cp-ingest-card[data-source="manual"]').trigger('click');
		});

		// 6. FAQ save/edit
		$container.on('submit', '#cp-kb-faq-form', function(e) {
			e.preventDefault();
			var $form = $(this);
			var $btn = $('#kb-faq-btn-submit');
			var $spinner = $btn.find('.cp-btn-spinner');

			$btn.prop('disabled', true);
			$spinner.show();

			var formData = $form.serializeArray();
			formData.push({ name: 'action', value: 'chat_pilot_save_kb_faq' });

			$.ajax({
				url: chatPilotAdmin.ajaxUrl,
				type: 'POST',
				data: formData,
				dataType: 'json',
				success: function(response) {
					if (response.success) {
						showNotification(response.data.message, 'success');
						setTimeout(function() {
							window.location.reload();
						}, 1200);
					} else {
						showNotification(response.data.message || 'FAQ save failed.', 'error');
					}
				},
				error: function() {
					showNotification('Connection error while saving FAQ.', 'error');
				},
				complete: function() {
					$btn.prop('disabled', false);
					$spinner.hide();
				}
			});
		});

		// Edit FAQ handler
		$container.on('click', '.cp-action-edit-faq', function(e) {
			e.preventDefault();
			var $btn = $(this);

			// Fill FAQ form
			$('#kb_faq_source_id').val($btn.data('id'));
			$('#kb_faq_question').val($btn.data('question'));
			$('#kb_faq_answer').val($btn.data('answer'));
			$('#kb_faq_category').val($btn.data('category'));

			// Configure visibility for edit (single) mode
			$('#cp-faq-bulk-container').hide();
			$('#kb_faq_bulk_paste').prop('required', false).val('');
			$('#cp-faq-single-container').show();
			$('#kb_faq_question').prop('required', true);
			$('#kb_faq_answer').prop('required', true);

			// Update buttons
			$('#kb-faq-btn-submit').html('🔄 Update FAQ Entry');

			// Trigger FAQ onboarding card click
			$('.cp-ingest-card[data-source="faq"]').trigger('click');
		});

		// 7. Sync KB Source trigger
		$container.on('click', '.cp-action-sync', function(e) {
			e.preventDefault();
			var $btn = $(this);
			var sourceId = $btn.data('id');
			var originalHtml = $btn.html();

			$btn.prop('disabled', true).html('⏳');

			$.ajax({
				url: chatPilotAdmin.ajaxUrl,
				type: 'POST',
				data: {
					action: 'chat_pilot_sync_kb_source',
					source_id: sourceId,
					_wpnonce: chatPilotAdmin.securityNonce
				},
				dataType: 'json',
				success: function(response) {
					if (response.success) {
						showNotification(response.data.message, 'success');
						setTimeout(function() {
							window.location.reload();
						}, 1000);
					} else {
						showNotification(response.data.message || 'Sync failed.', 'error');
					}
				},
				error: function() {
					showNotification('Connection error while syncing.', 'error');
				},
				complete: function() {
					$btn.prop('disabled', false).html(originalHtml);
				}
			});
		});

		// 8. Delete Source trigger
		$container.on('click', '.cp-action-delete', function(e) {
			e.preventDefault();
			if (!confirm('Are you sure you want to delete this source and all its parsed documents? This action is irreversible.')) {
				return;
			}
			var $btn = $(this);
			var sourceId = $btn.data('id');

			$.ajax({
				url: chatPilotAdmin.ajaxUrl,
				type: 'POST',
				data: {
					action: 'chat_pilot_delete_kb_source',
					source_id: sourceId,
					_wpnonce: chatPilotAdmin.securityNonce
				},
				dataType: 'json',
				success: function(response) {
					if (response.success) {
						showNotification(response.data.message, 'success');
						setTimeout(function() {
							window.location.reload();
						}, 800);
					} else {
						showNotification(response.data.message || 'Delete failed.', 'error');
					}
				},
				error: function() {
					showNotification('Connection error while deleting.', 'error');
				}
			});
		});

		// 9. Document Status switch toggle
		$container.on('change', '.cp-doc-status-toggle', function(e) {
			var $checkbox = $(this);
			var docId = $checkbox.data('id');
			var enable = $checkbox.is(':checked');

			$.ajax({
				url: chatPilotAdmin.ajaxUrl,
				type: 'POST',
				data: {
					action: 'chat_pilot_toggle_document_status',
					doc_id: docId,
					enable: enable ? 1 : 0,
					_wpnonce: chatPilotAdmin.securityNonce
				},
				dataType: 'json',
				success: function(response) {
					if (response.success) {
						showNotification(response.data.message, 'success');
					} else {
						showNotification(response.data.message || 'Toggle failed.', 'error');
						$checkbox.prop('checked', !enable);
					}
				},
				error: function() {
					showNotification('Connection error while updating document state.', 'error');
					$checkbox.prop('checked', !enable);
				}
			});
		});

		// 10. Diagnostics Retrieval test form
		$container.on('submit', '#cp-kb-search-form', function(e) {
			e.preventDefault();
			var $form = $(this);
			var $btn = $form.find('button[type="submit"]');
			var $spinner = $btn.find('.cp-btn-spinner');
			var $resultsBlock = $('#cp-kb-search-results');
			var $resultsList = $resultsBlock.find('.search-results-list');

			$btn.prop('disabled', true);
			$spinner.show();
			$resultsBlock.hide();
			$resultsList.empty();

			var formData = $form.serializeArray();
			formData.push({ name: 'action', value: 'chat_pilot_playground_kb_search' });

			$.ajax({
				url: chatPilotAdmin.ajaxUrl,
				type: 'POST',
				data: formData,
				dataType: 'json',
				success: function(response) {
					if (response.success) {
						$resultsBlock.show();
						
						// Render Summary Card
						$('#cp-diag-summary-query').text(response.data.query);
						$('#cp-diag-summary-total-docs').text(response.data.total_docs_searched);
						$('#cp-diag-summary-highest-score').text(response.data.highest_score.toFixed(4));
						$('#cp-diag-summary-threshold').text(response.data.configured_threshold.toFixed(2));
						
						var $status = $('#cp-diag-summary-status');
						if (response.data.status === 'passed') {
							$status.html('✅ Relevant Knowledge Found').css('color', '#4ade80');
						} else {
							$status.html('❌ No Relevant Knowledge Found').css('color', '#f87171');
						}

						// Render Document Lists
						if (response.data.documents && response.data.documents.length) {
							$.each(response.data.documents, function(i, doc) {
								var statusText = doc.passed ? 'Passed' : 'Below Threshold';
								var statusColor = doc.passed ? '#4ade80' : '#f87171';
								var docHtml = '<div class="cp-diag-item" style="border-left: 4px solid ' + statusColor + '; padding-left: 1rem; margin-bottom: 1.25rem;">' +
									'<div class="cp-diag-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.25rem;">' +
										'<span class="cp-diag-title" style="font-weight:600; color:#ffffff;">' + escapeHtml(doc.title) + '</span>' +
										'<span class="cp-diag-score" style="color:' + statusColor + '; font-size:0.85rem; font-weight:600;">Score: ' + doc.relevance_score.toFixed(4) + ' (' + statusText + ')</span>' +
									'</div>' +
									'<div class="cp-diag-source" style="font-size:0.75rem; color:#94a3b8; margin-bottom:0.5rem;">Source: <strong>' + escapeHtml(doc.source) + '</strong> (' + doc.source_type.toUpperCase() + ') | Words: ' + doc.word_count + '</div>' +
									'<div class="cp-diag-content" style="font-size:0.85rem; color:#cbd5e1; line-height:1.5;">' + escapeHtml(doc.content) + '</div>' +
								'</div>';
								$resultsList.append(docHtml);
							});
						} else {
							$resultsList.html('<p style="font-style:italic; color:var(--text-secondary); text-align:center; padding: 1.5rem;">No matching documents found in database.</p>');
						}
					} else {
						showNotification(response.data.message || 'Playground search query failed.', 'error');
					}
				},
				error: function() {
					showNotification('Connection error while testing search.', 'error');
				},
				complete: function() {
					$btn.prop('disabled', false);
					$spinner.hide();
				}
			});
		});

		function escapeHtml(text) {
			if (!text) return '';
			return text
				.replace(/&/g, "&amp;")
				.replace(/</g, "&lt;")
				.replace(/>/g, "&gt;")
				.replace(/"/g, "&quot;")
				.replace(/'/g, "&#039;");
		}

		// Helper: Show notification banner.
		function showNotification(message, type) {
			$notification.removeClass('cp-alert-success cp-alert-error').addClass('cp-alert-' + type);
			$notification.find('.cp-notification-text').text(message);
			$notification.fadeIn(300);
			
			if (type === 'success') {
				setTimeout(function() {
					$notification.fadeOut(300);
				}, 4000);
			}
		}

		$notification.on('click', '.cp-notification-close', function() {
			$notification.fadeOut(300);
		});

		// ==========================================
		// 15. Forms & Submissions Subsystem Binding
		// ==========================================
		var $formsContainer = $('.cp-forms-dashboard-wrapper');
		if ($formsContainer.length) {
			var activeFormFields = [];
			var activeFormId = 0;

			// Handle sidebar form click to load for editing (does NOT change default form)
			$('body').on('click', '.cp-form-item-card', function(e) {
				if ($(e.target).hasClass('cp-form-act-btn') || $(e.target).closest('.cp-form-act-btn').length) {
					return;
				}
				var formId = $(this).data('form-id');
				localStorage.setItem('cp_last_edited_form_id', formId);

				$('.cp-form-item-card').removeClass('active-editing-card').css({'border-color':'rgba(255,255,255,0.06)'});
				$(this).addClass('active-editing-card').css({'border-color':'var(--accent-cyan)'});

				loadFormInBuilder(formId);
			});

			// Create New Form Button
			$('#cp-create-new-form-btn').on('click', function() {
				activeFormId = 0;
				activeFormFields = [
					{ id: 'name', type: 'text', label: 'Name', placeholder: 'Enter your name...', required: true, enabled: true, order: 0, options: '', validation: 'none' },
					{ id: 'email', type: 'email', label: 'Email', placeholder: 'Enter your email...', required: true, enabled: true, order: 1, options: '', validation: 'email' }
				];
				$('#cp-builder-form-id').val('0');
				$('#cp-form-name-input').val('New Custom Form');
				$('#cp-builder-form-title').text('Create New Lead Form');
				$('#cp-builder-form-status-indicator').text('(Unsaved)');
				redrawFieldsList();
				renderLivePreview();
			});

			// Add custom field row
			$('#cp-builder-add-field-btn').on('click', function() {
				var count = activeFormFields.length;
				var uniqueId = 'custom_' + Date.now() + '_' + Math.floor(Math.random() * 100);
				activeFormFields.push({
					id: uniqueId,
					type: 'text',
					label: 'Custom Field ' + (count + 1),
					placeholder: 'Enter details...',
					required: false,
					enabled: true,
					order: count,
					options: 'Option 1\nOption 2\nOption 3',
					validation: 'none'
				});
				redrawFieldsList();
				renderLivePreview();
			});

			// Delete field row
			$('body').on('click', '.cp-field-row-delete', function() {
				var idx = $(this).closest('.cp-builder-field-item').data('index');
				activeFormFields.splice(idx, 1);
				redrawFieldsList();
				renderLivePreview();
			});

			// Move field order up
			$('body').on('click', '.cp-field-row-move-up', function() {
				var idx = $(this).closest('.cp-builder-field-item').data('index');
				if (idx > 0) {
					var temp = activeFormFields[idx];
					activeFormFields[idx] = activeFormFields[idx - 1];
					activeFormFields[idx - 1] = temp;
					redrawFieldsList();
					renderLivePreview();
				}
			});

			// Move field order down
			$('body').on('click', '.cp-field-row-move-down', function() {
				var idx = $(this).closest('.cp-builder-field-item').data('index');
				if (idx < activeFormFields.length - 1) {
					var temp = activeFormFields[idx];
					activeFormFields[idx] = activeFormFields[idx + 1];
					activeFormFields[idx + 1] = temp;
					redrawFieldsList();
					renderLivePreview();
				}
			});

			// Monitor changes in field row inputs to update live preview
			$('body').on('input change', '.cp-field-input-monitor', function() {
				var $row = $(this).closest('.cp-builder-field-item');
				var idx = $row.data('index');
				
				if (activeFormFields[idx]) {
					activeFormFields[idx].label = $row.find('.cp-field-label-in').val();
					activeFormFields[idx].placeholder = $row.find('.cp-field-placeholder-in').val();
					activeFormFields[idx].type = $row.find('.cp-field-type-in').val();
					activeFormFields[idx].required = $row.find('.cp-field-required-in').is(':checked');
					activeFormFields[idx].enabled = $row.find('.cp-field-enabled-in').is(':checked');
					activeFormFields[idx].options = $row.find('.cp-field-options-in').val();
					activeFormFields[idx].validation = $row.find('.cp-field-validation-in').val();

					var type = activeFormFields[idx].type;
					if (type === 'dropdown' || type === 'select' || type === 'radio') {
						$row.find('.cp-field-options-container').show();
					} else {
						$row.find('.cp-field-options-container').hide();
					}
					
					renderLivePreview();
				}
			});

			// Preview device switcher
			$('.cp-preview-device-toggle').on('click', function() {
				var device = $(this).data('device');
				$('.cp-preview-device-toggle').removeClass('cp-preview-dev-active').css({'background':'', 'color':''});
				$(this).addClass('cp-preview-dev-active').css({'background':'rgba(255,255,255,0.05)', 'color':'#ffffff'});
				
				var $frame = $('#cp-preview-device-frame');
				if (device === 'mobile') {
					$frame.css({
						'width': '280px',
						'margin': '0 auto',
						'border-radius': '20px',
						'border': '6px solid rgba(255,255,255,0.15)'
					});
				} else {
					$frame.css({
						'width': '100%',
						'margin': '0',
						'border-radius': '12px',
						'border': '1px solid rgba(255,255,255,0.08)'
					});
				}
			});

			// Save Form AJAX
			$('#cp-form-builder-editor').on('submit', function(e) {
				e.preventDefault();
				var name = $('#cp-form-name-input').val();
				if (!name.trim()) {
					alert('Form Title is required.');
					return;
				}

				$.each(activeFormFields, function(i, field) {
					field.order = i;
				});

				var isDefault = $('#cp-builder-form-is-default').is(':checked') ? 1 : 0;
				var $btn = $(this).find('button[type="submit"]');
				var originalBtnHtml = $btn.html();
				$btn.prop('disabled', true).html('Saving Form...');

				$.ajax({
					url: chatPilotAdmin.ajaxUrl,
					type: 'POST',
					data: {
						action: 'chat_pilot_save_form',
						id: activeFormId,
						name: name,
						is_default: isDefault,
						fields: activeFormFields,
						_wpnonce: chatPilotAdmin.securityNonce
					},
					dataType: 'json',
					success: function(response) {
						if (response.success) {
							var savedId = response.data.form_id || activeFormId;
							if (savedId) {
								localStorage.setItem('cp_last_edited_form_id', savedId);
							}
							showNotification(response.data.message, 'success');
							setTimeout(function() {
								window.location.reload();
							}, 1000);
						} else {
							showNotification(response.data.message || 'Failed to save form.', 'error');
						}
					},
					error: function() {
						showNotification('Network connection error while saving form.', 'error');
					},
					complete: function() {
						$btn.prop('disabled', false).html(originalBtnHtml);
					}
				});
			});

			// Duplicate Form Action
			$('body').on('click', '.cp-form-act-duplicate', function(e) {
				e.stopPropagation();
				var formId = $(this).closest('.cp-form-item-card').data('form-id');
				if (confirm('Duplicate this form?')) {
					$.ajax({
						url: chatPilotAdmin.ajaxUrl,
						type: 'POST',
						data: {
							action: 'chat_pilot_duplicate_form',
							id: formId,
							_wpnonce: chatPilotAdmin.securityNonce
						},
						dataType: 'json',
						success: function(response) {
							if (response.success) {
								showNotification(response.data.message, 'success');
								setTimeout(function() {
									window.location.reload();
								}, 1000);
							} else {
								showNotification(response.data.message, 'error');
							}
						}
					});
				}
			});

			// Set Default Form Action
			$('body').on('click', '.cp-form-act-default', function(e) {
				e.stopPropagation();
				var formId = $(this).closest('.cp-form-item-card').data('form-id');
				$.ajax({
					url: chatPilotAdmin.ajaxUrl,
					type: 'POST',
					data: {
						action: 'chat_pilot_set_default_form',
						id: formId,
						_wpnonce: chatPilotAdmin.securityNonce
					},
					dataType: 'json',
					success: function(response) {
						if (response.success) {
							showNotification(response.data.message, 'success');
							setTimeout(function() {
								window.location.reload();
							}, 1000);
						} else {
							showNotification(response.data.message, 'error');
						}
					}
				});
			});

			// Delete Form Action
			$('body').on('click', '.cp-form-act-delete', function(e) {
				e.stopPropagation();
				var formId = $(this).closest('.cp-form-item-card').data('form-id');
				if (confirm('Are you absolutely sure you want to delete this form? Submissions linked to this form will remain in logs.')) {
					$.ajax({
						url: chatPilotAdmin.ajaxUrl,
						type: 'POST',
						data: {
							action: 'chat_pilot_delete_form',
							id: formId,
							_wpnonce: chatPilotAdmin.securityNonce
						},
						dataType: 'json',
						success: function(response) {
							if (response.success) {
								showNotification(response.data.message, 'success');
								setTimeout(function() {
									window.location.reload();
								}, 1000);
							} else {
								showNotification(response.data.message, 'error');
							}
						}
					});
				}
			});

			// Edit action button in list row
			$('body').on('click', '.cp-form-act-edit', function(e) {
				e.stopPropagation();
				var formId = $(this).closest('.cp-form-item-card').data('form-id');
				loadFormInBuilder(formId);
			});

			// Delete submission
			$('body').on('click', '.cp-delete-sub-btn', function() {
				var subId = $(this).data('sub-id');
				if (confirm('Delete this lead submission record permanently?')) {
					var $row = $(this).closest('.cp-submission-row');
					$.ajax({
						url: chatPilotAdmin.ajaxUrl,
						type: 'POST',
						data: {
							action: 'chat_pilot_delete_submission',
							id: subId,
							_wpnonce: chatPilotAdmin.securityNonce
						},
						dataType: 'json',
						success: function(response) {
							if (response.success) {
								showNotification(response.data.message, 'success');
								$row.fadeOut(200, function() {
									$row.remove();
								});
							} else {
								showNotification(response.data.message || 'Failed to delete submission.', 'error');
							}
						}
					});
				}
			});

			// View submission details modal popup
			$('body').on('click', '.cp-view-sub-btn', function() {
				var subId = $(this).data('sub-id');
				var $list = $('#cp-modal-fields-list').html('<p style="text-align:center; padding:2rem;"><span class="spinner is-active" style="float:none;"></span> Loading...</p>');
				$('#cp-submission-details-modal').css('display', 'flex');

				$.ajax({
					url: chatPilotAdmin.ajaxUrl,
					type: 'POST',
					data: {
						action: 'chat_pilot_get_source_history',
						sub_id: subId,
						action_type: 'get_submission_detail',
						_wpnonce: chatPilotAdmin.securityNonce
					},
					dataType: 'json',
					success: function(response) {
						if (response.success && response.data) {
							var sub = response.data;
							var html = '<ul style="list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:0.75rem;">';
							
							html += '<li><strong>Submission ID:</strong> <span style="font-family:monospace;">#' + sub.id + '</span></li>';
							html += '<li><strong>Date Submitted:</strong> ' + sub.created_at + '</li>';
							html += '<li><strong>Page URL:</strong> <a href="' + escapeHtml(sub.page_url) + '" target="_blank" style="color:var(--accent-cyan); word-break:break-all;">' + escapeHtml(sub.page_url) + '</a></li>';
							
							html += '<li style="border-top:1px solid rgba(255,255,255,0.06); margin-top:0.5rem; padding-top:0.5rem;"><strong>Name:</strong> ' + escapeHtml(sub.name || '—') + '</li>';
							html += '<li><strong>Email:</strong> ' + escapeHtml(sub.email || '—') + '</li>';
							html += '<li><strong>Phone:</strong> ' + escapeHtml(sub.phone || '—') + '</li>';

							if (sub.custom_fields && Object.keys(sub.custom_fields).length) {
								html += '<li style="border-top:1px solid rgba(255,255,255,0.06); margin-top:0.5rem; padding-top:0.5rem;"><strong>Custom Data Fields:</strong></li>';
								$.each(sub.custom_fields, function(k, v) {
									var displayVal = Array.isArray(v) ? v.join(', ') : v;
									html += '<li style="padding-left:1rem;">• <strong>' + escapeHtml(k) + ':</strong> ' + escapeHtml(displayVal) + '</li>';
								});
							}

							if (sub.conversation_id > 0) {
								html += '<li style="border-top:1px solid rgba(255,255,255,0.06); margin-top:0.5rem; padding-top:0.5rem;"><strong>Associated Conversation ID:</strong> #' + sub.conversation_id + '</li>';
							}

							html += '</ul>';
							$list.html(html);
						} else {
							$list.html('<p style="color:#ef4444;">Failed to load details.</p>');
						}
					},
					error: function() {
						$list.html('<p style="color:#ef4444;">Connection error.</p>');
					}
				});
			});

			$('#cp-close-modal-btn, #cp-close-modal-bottom-btn').on('click', function() {
				$('#cp-submission-details-modal').hide();
			});

			function loadFormInBuilder(formId) {
				var selectedForm = null;
				if (window.chatPilotBuilderForms && window.chatPilotBuilderForms.length) {
					$.each(window.chatPilotBuilderForms, function(i, f) {
						if (parseInt(f.id) === parseInt(formId)) {
							selectedForm = f;
							return false;
						}
					});
				}

				if (selectedForm) {
					activeFormId = selectedForm.id;
					activeFormFields = $.extend(true, [], selectedForm.fields || []);
					
					$('.cp-form-item-card').removeClass('active-edit-card').css({'background':'rgba(255,255,255,0.02)', 'border-color':'rgba(255,255,255,0.06)'});
					$('.cp-form-item-card[data-form-id="' + activeFormId + '"]').addClass('active-edit-card').css({'background':'rgba(6,182,212,0.04)', 'border-color':'var(--accent-cyan)'});

					$('#cp-builder-form-id').val(activeFormId);
					$('#cp-form-name-input').val(selectedForm.name);
					var isDef = (selectedForm.is_default === '1' || selectedForm.is_default === 1);
					$('#cp-builder-form-is-default').prop('checked', isDef);
					$('#cp-builder-form-title').text('Fields Designer - ' + selectedForm.name);
					$('#cp-builder-form-status-indicator').text(isDef ? '(Default Form)' : '');
					
					redrawFieldsList();
					renderLivePreview();
				}
			}

			function redrawFieldsList() {
				var $list = $('#cp-builder-fields-list').empty();
				if (!activeFormFields.length) {
					$list.html('<p style="color:var(--text-muted); text-align:center; font-style:italic; margin: 1rem 0;">No fields configured. Click "Add Custom Field" to start.</p>');
					return;
				}

				$.each(activeFormFields, function(i, field) {
					var optionsDisplay = (field.type === 'dropdown' || field.type === 'select' || field.type === 'radio') ? 'block' : 'none';
					
					var fieldHtml = '<div class="cp-builder-field-item" data-index="' + i + '" style="background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.05); padding:1rem; border-radius:6px; display:flex; flex-direction:column; gap:0.75rem;">' +
						'<div style="display:flex; justify-content:space-between; align-items:center; gap:0.5rem; border-bottom:1px solid rgba(255,255,255,0.03); padding-bottom:0.5rem;">' +
							'<span style="font-weight:700; color:var(--accent-cyan); font-size:0.85rem;">Field #' + (i + 1) + ' (' + field.type.toUpperCase() + ')</span>' +
							'<div style="display:flex; gap:0.4rem; align-items:center;">' +
								'<button type="button" class="cp-btn cp-btn-sm cp-field-row-move-up" style="margin:0; padding:0.15rem 0.35rem; font-size:0.7rem;" title="Move Up">↑</button>' +
								'<button type="button" class="cp-btn cp-btn-sm cp-field-row-move-down" style="margin:0; padding:0.15rem 0.35rem; font-size:0.7rem;" title="Move Down">↓</button>' +
								'<button type="button" class="cp-btn cp-btn-sm cp-field-row-delete" style="margin:0; padding:0.15rem 0.35rem; font-size:0.7rem; background:rgba(239,68,68,0.1); color:#ef4444; border-color:rgba(239,68,68,0.2);" title="Delete Field">✕</button>' +
							'</div>' +
						'</div>' +
						
						'<div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:0.75rem;">' +
							'<div class="cp-form-group" style="margin:0;">' +
								'<label class="cp-label" style="font-size:0.75rem;">Field Type</label>' +
								'<select class="cp-input cp-field-type-in cp-field-input-monitor" style="height:38px; min-height:38px; padding:0 0.75rem; line-height:36px; color:#ffffff !important; -webkit-text-fill-color:#ffffff !important; background-color:#1e293b !important; color-scheme:dark !important;">' +
									'<option value="text" ' + (field.type === 'text' ? 'selected' : '') + '>Text Field</option>' +
									'<option value="email" ' + (field.type === 'email' ? 'selected' : '') + '>Email Address</option>' +
									'<option value="phone" ' + (field.type === 'phone' ? 'selected' : '') + '>Phone Number</option>' +
									'<option value="textarea" ' + (field.type === 'textarea' ? 'selected' : '') + '>Multiline Textarea</option>' +
									'<option value="dropdown" ' + (field.type === 'dropdown' ? 'selected' : '') + '>Dropdown Select</option>' +
									'<option value="checkbox" ' + (field.type === 'checkbox' ? 'selected' : '') + '>Single Checkbox</option>' +
									'<option value="radio" ' + (field.type === 'radio' ? 'selected' : '') + '>Radio Choices</option>' +
									'<option value="company" ' + (field.type === 'company' ? 'selected' : '') + '>Company Name</option>' +
									'<option value="message" ' + (field.type === 'message' ? 'selected' : '') + '>Visitor Message</option>' +
								'</select>' +
							'</div>' +
							
							'<div class="cp-form-group" style="margin:0;">' +
								'<label class="cp-label" style="font-size:0.75rem;">Field Label</label>' +
								'<input type="text" class="cp-input cp-field-label-in cp-field-input-monitor" value="' + escapeHtml(field.label) + '" placeholder="e.g. Full Name" style="height:36px; padding:0.4rem;">' +
							'</div>' +
							
							'<div class="cp-form-group" style="margin:0;">' +
								'<label class="cp-label" style="font-size:0.75rem;">Placeholder</label>' +
								'<input type="text" class="cp-input cp-field-placeholder-in cp-field-input-monitor" value="' + escapeHtml(field.placeholder || '') + '" placeholder="e.g. Enter name..." style="height:36px; padding:0.4rem;" ' + (field.type === 'checkbox' ? 'disabled' : '') + '>' +
							'</div>' +
						'</div>' +

						'<div class="cp-field-options-container" style="display:' + optionsDisplay + '; margin-top:0.25rem;">' +
							'<label class="cp-label" style="font-size:0.75rem;">Options Choices (One per line)</label>' +
							'<textarea class="cp-input cp-field-options-in cp-field-input-monitor" style="height:60px; font-family:monospace; font-size:0.8rem; resize:vertical; padding:0.4rem;">' + escapeHtml(field.options || '') + '</textarea>' +
						'</div>' +

						'<div style="display:flex; gap:1.5rem; align-items:center; margin-top:0.25rem;">' +
							'<label class="cp-checkbox-label" style="cursor:pointer; display:inline-flex; align-items:center;">' +
								'<input type="checkbox" class="cp-checkbox cp-field-required-in cp-field-input-monitor" value="1" ' + (field.required ? 'checked' : '') + '>' +
								'<span style="font-size:0.8rem; color:#ffffff; margin-left:0.4rem;">Required Field</span>' +
							'</label>' +
							'<label class="cp-checkbox-label" style="cursor:pointer; display:inline-flex; align-items:center;">' +
								'<input type="checkbox" class="cp-checkbox cp-field-enabled-in cp-field-input-monitor" value="1" ' + (field.enabled ? 'checked' : '') + '>' +
								'<span style="font-size:0.8rem; color:#ffffff; margin-left:0.4rem;">Enabled Status</span>' +
							'</label>' +
							'<label class="cp-checkbox-label" style="margin-left:auto; display:inline-flex; align-items:center; color:var(--text-muted); font-size:0.75rem;">' +
								'<span>Field ID: <strong>' + escapeHtml(field.id) + '</strong></span>' +
							'</label>' +
						'</div>' +
					'</div>';
					$list.append(fieldHtml);
				});
			}

			var previewSessionId = 'cp_prev_sess_' + Math.random().toString(36).substring(2, 11);
			var previewVisitor = { name: '', email: '', phone: '' };

			function renderLivePreview() {
				var $container = $('#cp-preview-fields-container').empty();
				$('#cp-preview-error-msg').hide().empty();
				
				if (!activeFormFields.length) {
					$container.html('<p style="color:var(--text-muted); font-size:0.75rem; text-align:center; font-style:italic; padding:1rem 0;">No fields active.</p>');
					return;
				}

				var activeCount = 0;
				$.each(activeFormFields, function(i, field) {
					var enabled = (field.enabled === true || field.enabled === '1' || field.enabled === 1 || field.enabled === 'true');
					if (!enabled) {
						return;
					}
					activeCount++;
					var isRequiredStar = (field.required === true || field.required === '1' || field.required === 1 || field.required === 'true') ? ' <span style="color:#ef4444;">*</span>' : '';
					var placeholder = escapeHtml(field.placeholder || '');
					var label = escapeHtml(field.label);
					var fid = escapeHtml(field.id);

					var fieldHtml = '';
					if (field.type === 'checkbox') {
						fieldHtml = '<div style="display:flex; align-items:center; gap:0.4rem; margin-bottom:0.25rem;">' +
							'<input type="checkbox" id="cp-prev-field-' + fid + '" class="cp-prev-input-field" value="1" style="margin:0; width:14px; height:14px; cursor:pointer;">' +
							'<label for="cp-prev-field-' + fid + '" style="font-size:0.75rem; color:#cbd5e1; font-weight:normal; line-height:1.2; cursor:pointer;">' + label + isRequiredStar + '</label>' +
						'</div>';
					} else {
						fieldHtml = '<div style="display:flex; flex-direction:column; gap:3px; margin-bottom:0.5rem;">' +
							'<label for="cp-prev-field-' + fid + '" style="font-size:0.75rem; font-weight:600; color:#ffffff;">' + label + isRequiredStar + '</label>';
						
						if (field.type === 'textarea' || field.type === 'message') {
							fieldHtml += '<textarea id="cp-prev-field-' + fid + '" class="cp-prev-input-field cp-widget-input" style="height:45px; resize:none; font-size:0.75rem; border-radius:6px; background:rgba(255,255,255,0.05); color:#ffffff; border:1px solid rgba(255,255,255,0.1); padding:0.4rem;" placeholder="' + placeholder + '"></textarea>';
						} else if (field.type === 'dropdown' || field.type === 'select') {
							var options = (field.options || '').split('\n').filter(Boolean);
							fieldHtml += '<select id="cp-prev-field-' + fid + '" class="cp-prev-input-field cp-widget-input" style="height:30px; font-size:0.75rem; border-radius:6px; background:rgba(30,41,59,0.8); color:#ffffff; border:1px solid rgba(255,255,255,0.1); padding:0.15rem 0.5rem; width:100%;">';
							fieldHtml += '<option value="">— Select Option —</option>';
							$.each(options, function(idx, opt) {
								fieldHtml += '<option value="' + escapeHtml(opt.trim()) + '">' + escapeHtml(opt.trim()) + '</option>';
							});
							fieldHtml += '</select>';
						} else if (field.type === 'radio') {
							var radioOpts = (field.options || '').split('\n').filter(Boolean);
							fieldHtml += '<div style="display:flex; flex-direction:column; gap:0.2rem; margin-top:2px;">';
							$.each(radioOpts, function(idx, opt) {
								fieldHtml += '<label style="display:flex; align-items:center; gap:0.4rem; font-size:0.75rem; font-weight:normal; color:#cbd5e1; cursor:pointer;">';
								fieldHtml += '<input type="radio" name="cp-prev-radio-' + fid + '" class="cp-prev-input-field cp-prev-radio-grp" value="' + escapeHtml(opt.trim()) + '" data-field-id="' + fid + '" style="margin:0; width:14px; height:14px;">';
								fieldHtml += escapeHtml(opt.trim());
								fieldHtml += '</label>';
							});
							fieldHtml += '</div>';
						} else {
							var inputType = (field.type === 'email') ? 'email' : 'text';
							fieldHtml += '<input type="' + inputType + '" id="cp-prev-field-' + fid + '" class="cp-prev-input-field cp-widget-input" style="height:30px; font-size:0.75rem; border-radius:6px; background:rgba(255,255,255,0.05); color:#ffffff; border:1px solid rgba(255,255,255,0.1); padding:0.25rem 0.5rem;" placeholder="' + placeholder + '">';
						}
						
						fieldHtml += '</div>';
					}
					$container.append(fieldHtml);
				});

				if (activeCount === 0) {
					$container.html('<p style="color:var(--text-muted); font-size:0.75rem; text-align:center; font-style:italic; padding:1rem 0;">All fields disabled in form.</p>');
				}
			}

			// Submit pre-chat form in Live Preview
			$('#cp-preview-submit-btn').on('click', function(e) {
				e.preventDefault();
				var fieldsData = {};
				var hasErrors = false;
				var errorMessages = [];
				var $errorContainer = $('#cp-preview-error-msg');
				$errorContainer.hide().empty();

				$.each(activeFormFields, function(i, field) {
					var enabled = (field.enabled === true || field.enabled === '1' || field.enabled === 1 || field.enabled === 'true');
					if (!enabled) {
						return;
					}
					var fid = field.id;
					var val = '';

					if (field.type === 'checkbox') {
						val = $('#cp-prev-field-' + fid).is(':checked') ? '1' : '';
					} else if (field.type === 'radio') {
						val = $('input[name="cp-prev-radio-' + fid + '"]:checked').val() || '';
					} else {
						val = $('#cp-prev-field-' + fid).val() || '';
					}

					var isRequired = (field.required === true || field.required === '1' || field.required === 1 || field.required === 'true');
					if (isRequired && !val.trim()) {
						hasErrors = true;
						errorMessages.push('The field "' + field.label + '" is required.');
					}

					if (val.trim()) {
						if (field.type === 'email' && !/\S+@\S+\.\S+/.test(val)) {
							hasErrors = true;
							errorMessages.push('Please enter a valid email address for "' + field.label + '".');
						}
						if (field.type === 'phone') {
							var digits = val.replace(/[^0-9]/g, '');
							if (digits.length < 5) {
								hasErrors = true;
								errorMessages.push('Please enter a valid phone number for "' + field.label + '".');
							}
						}
					}

					fieldsData[fid] = val;
				});

				if (hasErrors) {
					var errHtml = '<ul style="margin:0; padding:0 0 0 1rem; list-style:disc;">';
					$.each(errorMessages, function(idx, msg) {
						errHtml += '<li>' + escapeHtml(msg) + '</li>';
					});
					errHtml += '</ul>';
					$errorContainer.html(errHtml).slideDown(150);
					return;
				}

				var $btn = $(this);
				$btn.prop('disabled', true).text('Submitting...');

				$.ajax({
					url: chatPilotAdmin.ajaxUrl,
					type: 'POST',
					data: {
						action: 'chat_pilot_submit_prechat_form',
						form_id: activeFormId || chatPilotAdmin.formId || 1,
						fields: fieldsData,
						session_id: previewSessionId,
						page_url: window.location.href,
						_wpnonce: chatPilotAdmin.widgetNonce || chatPilotAdmin.securityNonce
					},
					dataType: 'json',
					success: function(response) {
						if (response.success) {
							previewVisitor.name = fieldsData.name || '';
							previewVisitor.email = fieldsData.email || '';
							previewVisitor.phone = fieldsData.phone || '';

							$('#cp-preview-form-panel').fadeOut(200, function() {
								$('#cp-preview-chat-panel').css('display', 'flex').hide().fadeIn(200);
								$('#cp-preview-header-subtitle').text('Live Chat Simulator');
								$('#cp-preview-chat-input').focus();
							});
						} else {
							$errorContainer.text(response.data.message || 'Submission failed.').slideDown(150);
						}
					},
					error: function() {
						$errorContainer.text('Network error. Please try again.').slideDown(150);
					},
					complete: function() {
						$btn.prop('disabled', false).text('Start Chat');
					}
				});
			});

			// Reset Live Preview
			$('#cp-preview-reset-btn').on('click', function() {
				previewSessionId = 'cp_prev_sess_' + Math.random().toString(36).substring(2, 11);
				previewVisitor = { name: '', email: '', phone: '' };
				
				$('#cp-preview-chat-panel').hide();
				$('#cp-preview-chat-messages').html(
					'<div style="align-self:flex-start; max-width:85%; background:rgba(30,41,59,0.85); border:1px solid rgba(255,255,255,0.05); color:#e2e8f0; padding:0.6rem 0.85rem; border-radius:10px; border-top-left-radius:3px; line-height:1.4;">' +
						'Hi there! How can I help you today?' +
					'</div>'
				);
				$('#cp-preview-header-subtitle').text('Pre-chat Form');
				$('#cp-preview-form-panel').fadeIn(200);
				renderLivePreview();
			});

			// Chat Input Form Submit inside Live Preview
			$('#cp-preview-chat-input-form').on('submit', function(e) {
				e.preventDefault();
				var $input = $('#cp-preview-chat-input');
				var msg = $input.val().trim();
				if (!msg) return;

				$input.val('');
				var $msgs = $('#cp-preview-chat-messages');

				// Append user bubble
				$msgs.append(
					'<div style="align-self:flex-end; max-width:85%; background:var(--accent-cyan); color:#ffffff; padding:0.6rem 0.85rem; border-radius:10px; border-top-right-radius:3px; line-height:1.4; word-break:break-word;">' +
						escapeHtml(msg) +
					'</div>'
				);
				$msgs.scrollTop($msgs[0].scrollHeight);

				var $loading = $(
					'<div style="align-self:flex-start; max-width:85%; background:rgba(30,41,59,0.85); color:#94a3b8; padding:0.6rem 0.85rem; border-radius:10px; border-top-left-radius:3px; font-style:italic;">' +
						'Thinking...' +
					'</div>'
				);
				$msgs.append($loading);
				$msgs.scrollTop($msgs[0].scrollHeight);

				$.ajax({
					url: chatPilotAdmin.ajaxUrl,
					type: 'POST',
					data: {
						action: 'chat_pilot_chat',
						message: msg,
						session_id: previewSessionId,
						visitor_name: previewVisitor.name,
						visitor_email: previewVisitor.email,
						visitor_phone: previewVisitor.phone,
						_wpnonce: chatPilotAdmin.widgetNonce || chatPilotAdmin.securityNonce
					},
					dataType: 'json',
					success: function(response) {
						$loading.remove();
						if (response.success && response.data && response.data.text) {
							$msgs.append(
								'<div style="align-self:flex-start; max-width:85%; background:rgba(30,41,59,0.85); border:1px solid rgba(255,255,255,0.05); color:#e2e8f0; padding:0.6rem 0.85rem; border-radius:10px; border-top-left-radius:3px; line-height:1.4; word-break:break-word;">' +
									escapeHtml(response.data.text).replace(/\n/g, '<br>') +
								'</div>'
							);
						} else {
							$msgs.append(
								'<div style="align-self:flex-start; max-width:85%; background:rgba(239,68,68,0.15); border:1px solid rgba(239,68,68,0.3); color:#f87171; padding:0.6rem 0.85rem; border-radius:10px;">' +
									escapeHtml(response.data ? response.data.message : 'Error generating response.') +
								'</div>'
							);
						}
						$msgs.scrollTop($msgs[0].scrollHeight);
					},
					error: function() {
						$loading.remove();
						$msgs.append(
							'<div style="align-self:flex-start; max-width:85%; background:rgba(239,68,68,0.15); border:1px solid rgba(239,68,68,0.3); color:#f87171; padding:0.6rem 0.85rem; border-radius:10px;">' +
								'Network error. Could not connect to AI engine.' +
							'</div>'
						);
						$msgs.scrollTop($msgs[0].scrollHeight);
					}
				});
			});

			// Prefill saved/edited form on load
			if (window.chatPilotBuilderForms && window.chatPilotBuilderForms.length) {
				var defaultId = window.chatPilotBuilderForms[0].id;
				$.each(window.chatPilotBuilderForms, function(i, f) {
					if (f.is_default === '1' || f.is_default === 1) {
						defaultId = f.id;
						return false;
					}
				});

				var lastEditedId = localStorage.getItem('cp_last_edited_form_id');
				var targetId = defaultId;
				if (lastEditedId) {
					$.each(window.chatPilotBuilderForms, function(i, f) {
						if (String(f.id) === String(lastEditedId)) {
							targetId = f.id;
							return false;
						}
					});
				}

				loadFormInBuilder(targetId);
			} else {
				$('#cp-create-new-form-btn').trigger('click');
			}
		}

		// ==========================================
		// Analytics Module Controller
		// ==========================================
		var $analyticsWrap = $('.cp-analytics-wrap');
		if ($analyticsWrap.length) {
			var currentAnalyticsData = null;

			function loadAnalyticsData() {
				var range = $('#cp-an-date-range').val() || '30days';
				var dateFrom = $('#cp-an-date-from').val() || '';
				var dateTo = $('#cp-an-date-to').val() || '';
				var provider = $('#cp-an-filter-provider').val() || 'all';
				var model = $('#cp-an-filter-model').val() || 'all';
				var source = $('#cp-an-filter-source').val() || 'all';
				var formId = $('#cp-an-filter-form').val() || '0';
				var status = $('#cp-an-filter-status').val() || 'all';

				// Update CSV export link URL
				var exportUrl = chatPilotAdmin.ajaxUrl + '?action=chat_pilot_export_analytics_csv' +
					'&date_range=' + encodeURIComponent(range) +
					'&date_from=' + encodeURIComponent(dateFrom) +
					'&date_to=' + encodeURIComponent(dateTo) +
					'&provider=' + encodeURIComponent(provider) +
					'&model=' + encodeURIComponent(model) +
					'&source=' + encodeURIComponent(source) +
					'&form_id=' + encodeURIComponent(formId) +
					'&status=' + encodeURIComponent(status);
				$('#cp-analytics-export-csv').attr('href', exportUrl);

				$.ajax({
					url: chatPilotAdmin.ajaxUrl,
					type: 'POST',
					data: {
						action: 'chat_pilot_get_analytics',
						date_range: range,
						date_from: dateFrom,
						date_to: dateTo,
						provider: provider,
						model: model,
						source: source,
						form_id: formId,
						status: status,
						_wpnonce: chatPilotAdmin.securityNonce
					},
					dataType: 'json',
					success: function(response) {
						if (response.success && response.data) {
							currentAnalyticsData = response.data;
							renderAnalyticsDashboard(response.data);
						}
					}
				});
			}

			function renderAnalyticsDashboard(data) {
				// KPI Overview
				$('#cp-kpi-total-convs').text(data.overview.total_conversations);
				$('#cp-kpi-active-convs').text(data.overview.active_conversations);
				$('#cp-kpi-completed-convs').text(data.overview.completed_conversations);
				$('#cp-kpi-total-visitors').text(data.overview.total_visitors);
				$('#cp-kpi-total-leads').text(data.overview.total_leads);
				$('#cp-kpi-total-ai-reqs').text(data.overview.total_ai_requests);
				if ($('#cp-kpi-ai-successful').length) {
					$('#cp-kpi-ai-successful').text(data.ai_requests ? data.ai_requests.successful : (data.overview.successful_ai_requests || 0));
					var failedCount = data.ai_requests ? data.ai_requests.failed : (data.overview.failed_ai_requests || 0);
					$('#cp-kpi-ai-failed').text(failedCount);
					var provErrors = data.ai_requests ? (data.ai_requests.provider_errors || (data.ai_requests.quota_errors + data.ai_requests.auth_errors + data.ai_requests.timeout_errors + data.ai_requests.model_errors)) : (data.overview.provider_errors || 0);
					$('#cp-kpi-provider-errors').text(provErrors);
					var errRate = Number(data.overview.error_rate || (data.ai_requests ? data.ai_requests.error_rate : 0));
					$('#cp-kpi-error-rate').text(errRate.toFixed(1) + '%');
					if (failedCount > 0) {
						$('#cp-kpi-error-rate-badge').css({'background': 'rgba(239,68,68,0.2)', 'color': '#ef4444'});
						$('#cp-kpi-ai-failed').css('color', '#ef4444');
						$('#cp-kpi-provider-errors').css('color', '#ef4444');
					} else {
						$('#cp-kpi-error-rate-badge').css({'background': 'rgba(16,185,129,0.2)', 'color': '#10b981'});
						$('#cp-kpi-ai-failed').css('color', 'var(--text-muted)');
						$('#cp-kpi-provider-errors').css('color', 'var(--text-muted)');
					}
				} else {
					$('#cp-kpi-widget-reqs').text(data.ai_requests.widget_reqs);
					$('#cp-kpi-dev-reqs').text(data.ai_requests.dev_reqs);
				}
				$('#cp-kpi-total-tokens').text(Number(data.overview.total_tokens).toLocaleString());
				$('#cp-kpi-input-tokens').text(Number(data.overview.total_input_tokens).toLocaleString());
				$('#cp-kpi-output-tokens').text(Number(data.overview.total_output_tokens).toLocaleString());
				$('#cp-kpi-total-cost').text('$' + Number(data.overview.estimated_cost).toFixed(4));
				if (data.overview.widget_cost !== undefined) {
					$('#cp-kpi-widget-cost').text('$' + Number(data.overview.widget_cost).toFixed(4));
				}
				if (data.overview.dev_cost !== undefined) {
					$('#cp-kpi-dev-cost').text('$' + Number(data.overview.dev_cost).toFixed(4));
				}

				var remainingBudget = Number(data.overview.remaining_budget || 0);
				var monthlyBudget   = Number(data.overview.monthly_budget || 100);
				var usagePct        = Number(data.overview.usage_pct || 0);
				var isOverBudget    = data.overview.is_over_budget || (usagePct > 100);
				var exceededAmount  = Number(data.overview.exceeded_amount || (isOverBudget ? (data.overview.estimated_cost - monthlyBudget) : 0));
				var warningThresh   = Number(data.budget ? data.budget.warning_setting : 80);

				$('#cp-kpi-remaining-budget').text('$' + remainingBudget.toFixed(2));

				if (isOverBudget) {
					$('#cp-kpi-remaining-budget').css('color', '#ef4444');
					$('#cp-kpi-budget-badge')
						.text('Over Budget')
						.css({'background': 'rgba(239,68,68,0.2)', 'color': '#ef4444'});
					$('#cp-kpi-budget-subtext')
						.text('⚠️ Over Budget by $' + exceededAmount.toFixed(2) + ' (Budget: $' + monthlyBudget.toFixed(2) + ')')
						.css({'color': '#ef4444', 'font-weight': '700'});
					$('#cp-kpi-budget-progress-bar').css({
						'width': '100%',
						'background': '#ef4444'
					});
				} else if (usagePct >= 100) {
					$('#cp-kpi-remaining-budget').css('color', '#ef4444');
					$('#cp-kpi-budget-badge')
						.text('100% used')
						.css({'background': 'rgba(239,68,68,0.2)', 'color': '#ef4444'});
					$('#cp-kpi-budget-subtext')
						.text('Budget: $' + monthlyBudget.toFixed(2) + ' ($0.00 remaining)')
						.css({'color': '#ef4444', 'font-weight': '700'});
					$('#cp-kpi-budget-progress-bar').css({
						'width': '100%',
						'background': '#ef4444'
					});
				} else if (usagePct >= warningThresh) {
					$('#cp-kpi-remaining-budget').css('color', '#f59e0b');
					$('#cp-kpi-budget-badge')
						.text(usagePct.toFixed(1) + '% used')
						.css({'background': 'rgba(245,158,11,0.2)', 'color': '#f59e0b'});
					$('#cp-kpi-budget-subtext')
						.text('Budget: $' + monthlyBudget.toFixed(2) + ' ($' + remainingBudget.toFixed(2) + ' remaining)')
						.css({'color': '#f59e0b', 'font-weight': '600'});
					$('#cp-kpi-budget-progress-bar').css({
						'width': Math.min(100, usagePct) + '%',
						'background': '#f59e0b'
					});
				} else {
					$('#cp-kpi-remaining-budget').css('color', '#10b981');
					$('#cp-kpi-budget-badge')
						.text(usagePct.toFixed(1) + '% used')
						.css({'background': 'rgba(16,185,129,0.2)', 'color': '#10b981'});
					$('#cp-kpi-budget-subtext')
						.text('Budget: $' + monthlyBudget.toFixed(2) + ' ($' + remainingBudget.toFixed(2) + ' remaining)')
						.css({'color': 'var(--text-muted)', 'font-weight': '400'});
					$('#cp-kpi-budget-progress-bar').css({
						'width': Math.min(100, usagePct) + '%',
						'background': '#10b981'
					});
				}

				// Budget Banner Alert
				if (data.budget && data.budget.warning_status && data.budget.warning_status !== 'none') {
					$('#cp-budget-alert-text').text(data.budget.warning_label);
					$('#cp-budget-alert-banner').slideDown(150);
				} else {
					$('#cp-budget-alert-banner').slideUp(150);
				}

				// Provider Warning Banner Alert (Separate from internal budget)
				if (data.provider_alert && data.provider_alert.status && data.provider_alert.status !== 'operational') {
					$('#cp-provider-alert-title').text(data.provider_alert.provider + ' requests are currently being rejected (' + data.provider_alert.label + ')');
					var desc = data.provider_alert.message || 'The frontend widget is serving the safe visitor fallback response. Please review your provider quota or billing settings.';
					if (data.provider_alert.timestamp) {
						desc += ' [Last event: ' + data.provider_alert.timestamp + ']';
					}
					$('#cp-provider-alert-desc').text(desc);
					$('#cp-provider-alert-banner').slideDown(150);
				} else {
					$('#cp-provider-alert-banner').slideUp(150);
				}

				// Provider Operational Health Monitor Update
				if (data.provider_health && data.provider_health.length) {
					$.each(data.provider_health, function(i, ph) {
						var $card = $('.cp-provider-health-card[data-slug="' + ph.slug + '"]');
						if ($card.length) {
							var isOp = (ph.operational_status === 'operational');
							var isQuota = (ph.operational_status === 'quota_exceeded');
							var badgeBg = isOp ? 'rgba(16,185,129,0.15)' : (isQuota ? 'rgba(239,68,68,0.2)' : 'rgba(245,158,11,0.2)');
							var badgeColor = isOp ? '#10b981' : (isQuota ? '#ef4444' : '#f59e0b');

							$card.find('.cp-health-op-badge')
								.text(ph.operational_label)
								.css({'background': badgeBg, 'color': badgeColor});
							$card.find('.cp-health-op-state')
								.text(ph.operational_label)
								.css('color', badgeColor);

							var $errBox = $card.find('.cp-health-last-error');
							if (ph.last_error) {
								$errBox.html('<span style="font-weight:600;">Last Event:</span> ' + escapeHtml(ph.last_error) + (ph.last_error_time ? '<span style="display:block; color:var(--text-muted); font-size:0.68rem; margin-top:2px;">' + escapeHtml(ph.last_error_time) + '</span>' : '')).show();
								$card.css('border-color', 'rgba(239,68,68,0.3)');
							} else {
								$errBox.hide();
								$card.css('border-color', 'rgba(255,255,255,0.06)');
							}
						}
					});
				}

				// Sync Budget Form Inputs
				if (data.budget && data.budget.monthly_budget !== undefined) {
					if (!$('#cp-budget-monthly-input').is(':focus')) {
						$('#cp-budget-monthly-input').val(data.budget.monthly_budget);
					}
				}
				if (data.budget && data.budget.warning_setting !== undefined) {
					if (!$('#cp-budget-threshold-input').is(':focus')) {
						$('#cp-budget-threshold-input').val(data.budget.warning_setting);
					}
				}

				// KB Performance
				$('#cp-kb-success-rate').text(data.kb_performance.success_rate + '%');
				$('#cp-kb-avg-similarity').text(data.kb_performance.avg_similarity);
				$('#cp-kb-faq-count').text(data.kb_performance.faq_count);
				$('#cp-kb-manual-count').text(data.kb_performance.manual_count);
				$('#cp-kb-doc-count').text(data.kb_performance.doc_count);
				$('#cp-kb-website-count').text(data.kb_performance.website_count);
				$('#cp-kb-fallback-count').text(data.kb_performance.fallback_count);

				// Model Filter Population
				var currentModelVal = $('#cp-an-filter-model').val();
				var $modelSelect = $('#cp-an-filter-model');
				$modelSelect.find('option:not([value="all"])').remove();
				
				var modelMap = {};
				if (data.models && data.models.length) {
					$.each(data.models, function(i, m) {
						if (!modelMap[m.model]) {
							modelMap[m.model] = true;
							$modelSelect.append('<option value="' + escapeHtml(m.model) + '">' + escapeHtml(m.model) + '</option>');
						}
					});
				}
				$modelSelect.val(currentModelVal);

				// Model Analytics Table
				var $modelTbody = $('#cp-an-tbody-models');
				$modelTbody.empty();
				if (data.models && data.models.length) {
					$.each(data.models, function(i, m) {
						var tr = '<tr>' +
							'<td><strong style="color:#ffffff;">' + escapeHtml(m.model) + '</strong> <span style="font-size:0.75rem; color:var(--text-muted);">(' + escapeHtml(m.provider) + ')</span></td>' +
							'<td>' + Number(m.requests).toLocaleString() + '</td>' +
							'<td>' + Number(m.total_tokens).toLocaleString() + '</td>' +
							'<td>' + m.avg_latency + ' ms</td>' +
							'<td><strong style="color:var(--accent-cyan);">' + m.cost_fmt + '</strong></td>' +
						'</tr>';
						$modelTbody.append(tr);
					});
				} else {
					$modelTbody.append('<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding:1.5rem;">No model usage records found for selected range.</td></tr>');
				}

				// Visitor Usage Table
				var $visitorTbody = $('#cp-an-tbody-visitors');
				$visitorTbody.empty();
				if (data.visitors && data.visitors.length) {
					$.each(data.visitors, function(i, v) {
						var contactStr = v.email ? escapeHtml(v.email) : (v.phone ? escapeHtml(v.phone) : '<span style="color:var(--text-muted);">Anonymous Session</span>');
						var nameStr = escapeHtml(v.name);
						if (v.is_anonymous) {
							nameStr = '<span style="color:var(--text-muted); font-style:italic;">' + nameStr + '</span>';
						}

						var tr = '<tr>' +
							'<td><strong>' + nameStr + '</strong></td>' +
							'<td>' + contactStr + '</td>' +
							'<td>' + v.conv_count + '</td>' +
							'<td>' + v.req_count + '</td>' +
							'<td>' + Number(v.input_tokens).toLocaleString() + '</td>' +
							'<td>' + Number(v.output_tokens).toLocaleString() + '</td>' +
							'<td>' + Number(v.total_tokens).toLocaleString() + '</td>' +
							'<td><strong style="color:var(--accent-cyan);">$' + Number(v.cost).toFixed(4) + '</strong></td>' +
						'</tr>';
						$visitorTbody.append(tr);
					});
				} else {
					$visitorTbody.append('<tr><td colspan="8" style="text-align:center; color:var(--text-muted); padding:1.5rem;">No visitor usage data for selected range.</td></tr>');
				}

				// Render Visual Trend Chart
				renderSVGChart(data);
			}

			function renderSVGChart(data) {
				var metric = $('#cp-chart-metric-select').val() || 'tokens';
				var $container = $('#cp-analytics-chart-container');
				$container.empty();

				if (!data.trends || !data.trends.length) {
					$container.html('<div style="display:flex; justify-content:center; align-items:center; height:100%; color:var(--text-muted);">No trend data available</div>');
					return;
				}

				var maxVal = 0;
				$.each(data.trends, function(i, t) {
					var val = 0;
					if (metric === 'conversations') val = t.conversations;
					else if (metric === 'leads') val = t.leads;
					else if (metric === 'ai_requests') val = t.ai_requests;
					else if (metric === 'tokens') val = t.total_tokens;
					else if (metric === 'cost') val = t.cost;
					if (val > maxVal) maxVal = val;
				});

				if (maxVal === 0) maxVal = 1;

				var width = $container.width() || 700;
				var height = 220;
				var padding = 35;
				var points = [];

				var stepX = (width - padding * 2) / Math.max(1, data.trends.length - 1);

				$.each(data.trends, function(i, t) {
					var val = 0;
					if (metric === 'conversations') val = t.conversations;
					else if (metric === 'leads') val = t.leads;
					else if (metric === 'ai_requests') val = t.ai_requests;
					else if (metric === 'tokens') val = t.total_tokens;
					else if (metric === 'cost') val = t.cost;

					var x = padding + i * stepX;
					var y = height - padding - ((val / maxVal) * (height - padding * 2));
					points.push({ x: x, y: y, val: val, label: t.label });
				});

				var pathD = 'M ' + points[0].x + ' ' + points[0].y;
				var areaD = 'M ' + points[0].x + ' ' + (height - padding) + ' L ' + points[0].x + ' ' + points[0].y;

				for (var i = 1; i < points.length; i++) {
					pathD += ' L ' + points[i].x + ' ' + points[i].y;
					areaD += ' L ' + points[i].x + ' ' + points[i].y;
				}

				areaD += ' L ' + points[points.length - 1].x + ' ' + (height - padding) + ' Z';

				var svg = '<svg width="100%" height="100%" viewBox="0 0 ' + width + ' ' + height + '" preserveAspectRatio="none" style="overflow:visible;">' +
					'<defs>' +
						'<linearGradient id="cpChartGrad" x1="0" y1="0" x2="0" y2="1">' +
							'<stop offset="0%" stop-color="#06b6d4" stop-opacity="0.35"/>' +
							'<stop offset="100%" stop-color="#06b6d4" stop-opacity="0.0"/>' +
						'</linearGradient>' +
					'</defs>' +
					'<path d="' + areaD + '" fill="url(#cpChartGrad)"/>' +
					'<path d="' + pathD + '" fill="none" stroke="#06b6d4" stroke-width="3" stroke-linecap="round"/>';

				$.each(points, function(i, pt) {
					var displayVal = pt.val;
					if (metric === 'tokens') displayVal = Number(pt.val).toLocaleString() + ' tokens';
					else if (metric === 'cost') displayVal = '$' + Number(pt.val).toFixed(4);
					else if (metric === 'conversations') displayVal = pt.val + ' conversations';
					else if (metric === 'leads') displayVal = pt.val + ' leads';
					else if (metric === 'ai_requests') displayVal = pt.val + ' requests';

					svg += '<circle class="cp-chart-point-hit" data-label="' + pt.label + '" data-val="' + displayVal + '" cx="' + pt.x + '" cy="' + pt.y + '" r="14" fill="transparent" style="cursor:pointer;"></circle>';
					svg += '<circle class="cp-chart-point-dot" cx="' + pt.x + '" cy="' + pt.y + '" r="5" fill="#06b6d4" stroke="#0f172a" stroke-width="2" style="pointer-events:none; transition: all 0.15s ease;"></circle>';
				});

				svg += '</svg>';
				$container.html(svg);

				// Tooltip creation & event handling
				$('#cp-chart-tooltip').remove();
				var $tooltip = $('<div id="cp-chart-tooltip" style="display:none; position:fixed; z-index:99999; background:rgba(15, 23, 42, 0.92); backdrop-filter:blur(8px); border:1px solid var(--accent-cyan); border-radius:8px; padding:0.5rem 0.75rem; color:#ffffff; font-size:0.78rem; font-weight:600; box-shadow:0 10px 25px rgba(0,0,0,0.5); pointer-events:none; white-space:nowrap; transition: opacity 0.1s ease;"></div>').appendTo('body');

				$container.off('mouseenter mousemove mouseleave', '.cp-chart-point-hit');

				$container.on('mouseenter', '.cp-chart-point-hit', function(e) {
					var $hit = $(this);
					var label = $hit.data('label');
					var val = $hit.data('val');
					$hit.next('.cp-chart-point-dot').attr('r', 7).attr('fill', '#ffffff').attr('stroke', '#06b6d4');
					$tooltip.html('<div style="color:var(--text-muted); font-size:0.7rem; font-weight:500; margin-bottom:2px;">' + label + '</div><div style="color:var(--accent-cyan); font-size:0.85rem; font-weight:700;">' + val + '</div>').show();
				});

				$container.on('mousemove', '.cp-chart-point-hit', function(e) {
					$tooltip.css({
						left: (e.clientX + 12) + 'px',
						top: (e.clientY - 35) + 'px'
					});
				});

				$container.on('mouseleave', '.cp-chart-point-hit', function() {
					$(this).next('.cp-chart-point-dot').attr('r', 5).attr('fill', '#06b6d4').attr('stroke', '#0f172a');
					$tooltip.hide();
				});
			}

			// Date Range Buttons
			$('.cp-analytics-range-btn').on('click', function() {
				var $btn = $(this);
				var range = $btn.data('range');
				$('.cp-analytics-range-btn').removeClass('cp-active-range').css({ 'background': 'none', 'color': 'var(--text-secondary)' });
				$btn.addClass('cp-active-range').css({ 'background': 'var(--accent-cyan)', 'color': '#ffffff' });

				$('#cp-an-date-range').val(range);
				if (range === 'custom') {
					$('#cp-analytics-custom-dates').css('display', 'flex');
				} else {
					$('#cp-analytics-custom-dates').hide();
					loadAnalyticsData();
				}
			});

			// Filter Form Submit
			$('#cp-analytics-filter-form').on('submit', function(e) {
				e.preventDefault();
				loadAnalyticsData();
			});

			// Filter Reset
			$('#cp-analytics-reset-filters').on('click', function() {
				$('#cp-an-date-range').val('30days');
				$('.cp-analytics-range-btn').removeClass('cp-active-range').css({ 'background': 'none', 'color': 'var(--text-secondary)' });
				$('.cp-analytics-range-btn[data-range="30days"]').addClass('cp-active-range').css({ 'background': 'var(--accent-cyan)', 'color': '#ffffff' });
				$('#cp-analytics-custom-dates').hide();
				$('#cp-an-date-from, #cp-an-date-to').val('');
				$('#cp-an-filter-provider, #cp-an-filter-model, #cp-an-filter-source, #cp-an-filter-form, #cp-an-filter-status').val('all');
				loadAnalyticsData();
			});

			// Chart Metric Dropdown Change
			$('#cp-chart-metric-select').on('change', function() {
				if (currentAnalyticsData) {
					renderSVGChart(currentAnalyticsData);
				}
			});

			// Budget Form Submit
			$('#cp-analytics-budget-form').on('submit', function(e) {
				e.preventDefault();
				var budget = $('#cp-budget-monthly-input').val();
				var threshold = $('#cp-budget-threshold-input').val();

				$.ajax({
					url: chatPilotAdmin.ajaxUrl,
					type: 'POST',
					data: {
						action: 'chat_pilot_save_budget_settings',
						monthly_budget: budget,
						warning_threshold: threshold,
						_wpnonce: chatPilotAdmin.securityNonce
					},
					dataType: 'json',
					success: function(response) {
						if (response.success) {
							showNotification(response.data.message || 'Budget saved successfully!', 'success');
							loadAnalyticsData();
						} else {
							showNotification(response.data.message || 'Failed to save budget.', 'error');
						}
					}
				});
			});

			// Load Analytics on init
			loadAnalyticsData();
		}

		/* ==========================================================================
		   SETTINGS MODULE CONTROLLER
		   ========================================================================== */
		if ($('.cp-settings-center-wrap').length) {

			// 1. Sidebar Section Navigation
			$('.cp-st-nav-btn').on('click', function() {
				var $btn = $(this);
				var targetId = $btn.data('target');

				$('.cp-st-nav-btn').removeClass('active').css({
					'background': 'none',
					'color': 'var(--text-secondary)'
				});
				$btn.addClass('active');

				if (targetId === 'cp-st-sec-maintenance') {
					$btn.css({ 'background': 'rgba(239, 68, 68, 0.15)', 'color': '#ef4444' });
				} else {
					$btn.css({ 'background': 'rgba(6, 182, 212, 0.15)', 'color': 'var(--accent-cyan)' });
				}

				$('.cp-settings-section').hide();
				$('#' + targetId).fadeIn(150);
			});

			// 2. Settings Main Form Submit
			$('#cp-settings-main-form').on('submit', function(e) {
				e.preventDefault();
				var $form = $(this);
				var formData = $form.serializeArray();

				formData.push({ name: 'action', value: 'chat_pilot_save_settings' });
				formData.push({ name: '_wpnonce', value: chatPilotAdmin.securityNonce });

				showNotification('Saving global settings...', 'info');

				$.ajax({
					url: chatPilotAdmin.ajaxUrl,
					type: 'POST',
					data: $.param(formData),
					dataType: 'json',
					success: function(res) {
						if (res.success) {
							showNotification(res.data.message || 'Settings saved successfully!', 'success');
						} else {
							showNotification(res.data.message || 'Failed to save settings.', 'error');
						}
					},
					error: function() {
						showNotification('Network error while saving settings.', 'error');
					}
				});
			});

			// 3. Clear System Logs
			$('#cp-btn-clear-logs').on('click', function() {
				if (!confirm('Are you sure you want to clear all system database logs?')) return;

				$.ajax({
					url: chatPilotAdmin.ajaxUrl,
					type: 'POST',
					data: {
						action: 'chat_pilot_clear_logs',
						_wpnonce: chatPilotAdmin.securityNonce
					},
					dataType: 'json',
					success: function(res) {
						if (res.success) {
							showNotification(res.data.message, 'success');
							setTimeout(function() { location.reload(); }, 1200);
						} else {
							showNotification(res.data.message || 'Failed to clear logs.', 'error');
						}
					}
				});
			});

			// 4. Clear Cache
			$('#cp-btn-clear-cache').on('click', function() {
				$.ajax({
					url: chatPilotAdmin.ajaxUrl,
					type: 'POST',
					data: {
						action: 'chat_pilot_clear_cache',
						_wpnonce: chatPilotAdmin.securityNonce
					},
					dataType: 'json',
					success: function(res) {
						if (res.success) {
							showNotification(res.data.message, 'success');
						} else {
							showNotification(res.data.message || 'Failed to clear cache.', 'error');
						}
					}
				});
			});

			// 5. Re-sync Metadata & Schema
			$('#cp-btn-resync-meta').on('click', function() {
				showNotification('Re-syncing database tables & metadata...', 'info');
				$.ajax({
					url: chatPilotAdmin.ajaxUrl,
					type: 'POST',
					data: {
						action: 'chat_pilot_resync_metadata',
						_wpnonce: chatPilotAdmin.securityNonce
					},
					dataType: 'json',
					success: function(res) {
						if (res.success) {
							showNotification(res.data.message, 'success');
							setTimeout(function() { location.reload(); }, 1200);
						} else {
							showNotification(res.data.message || 'Re-sync failed.', 'error');
						}
					}
				});
			});

			// Modal Handler Variables
			var pendingAction = null;
			var pendingSection = '';

			function openModal(title, body, requiresInput, actionType, sectionName) {
				$('#cp-modal-title').html('⚠️ ' + title);
				$('#cp-modal-body').text(body);
				pendingAction = actionType;
				pendingSection = sectionName || '';

				if (requiresInput) {
					$('#cp-modal-confirm-input-wrap').show();
					$('#cp-modal-confirm-input').val('');
				} else {
					$('#cp-modal-confirm-input-wrap').hide();
				}

				$('#cp-settings-modal-overlay').css('display', 'flex');
			}

			function closeModal() {
				$('#cp-settings-modal-overlay').hide();
				pendingAction = null;
				pendingSection = '';
			}

			$('#cp-modal-cancel-btn').on('click', closeModal);

			// 6. Reset General Section Button
			$('#cp-btn-reset-section').on('click', function() {
				var activeSec = $('.cp-st-nav-btn.active').data('target').replace('cp-st-sec-', '');
				openModal(
					'Reset Section Settings',
					'Are you sure you want to reset all settings in the "' + activeSec.toUpperCase() + '" section to default values?',
					false,
					'reset_section',
					activeSec
				);
			});

			// 7. Full System Factory Reset Button
			$('#cp-btn-factory-reset').on('click', function() {
				openModal(
					'Full System Factory Reset',
					'WARNING: This will reset all global plugin configurations back to factory defaults. Your Knowledge Base, Conversations, and Form Submissions data will NOT be deleted.',
					true,
					'factory_reset',
					''
				);
			});

			// Modal Action Proceed Button
			$('#cp-modal-action-btn').on('click', function() {
				if (pendingAction === 'reset_section') {
					$.ajax({
						url: chatPilotAdmin.ajaxUrl,
						type: 'POST',
						data: {
							action: 'chat_pilot_reset_section',
							section: pendingSection,
							_wpnonce: chatPilotAdmin.securityNonce
						},
						dataType: 'json',
						success: function(res) {
							closeModal();
							if (res.success) {
								showNotification(res.data.message, 'success');
								setTimeout(function() { location.reload(); }, 1000);
							} else {
								showNotification(res.data.message || 'Reset failed.', 'error');
							}
						}
					});
				} else if (pendingAction === 'factory_reset') {
					var confirmTxt = $('#cp-modal-confirm-input').val().trim();
					if (confirmTxt.toUpperCase() !== 'YES') {
						showNotification('Please type YES in the box to confirm factory reset.', 'error');
						return;
					}

					$.ajax({
						url: chatPilotAdmin.ajaxUrl,
						type: 'POST',
						data: {
							action: 'chat_pilot_factory_reset',
							confirm_reset: 'YES',
							_wpnonce: chatPilotAdmin.securityNonce
						},
						dataType: 'json',
						success: function(res) {
							closeModal();
							if (res.success) {
								showNotification(res.data.message, 'success');
								setTimeout(function() { location.reload(); }, 1200);
							} else {
								showNotification(res.data.message || 'Factory reset failed.', 'error');
							}
						}
					});
				}
			});
		}
	});
})(jQuery);
