<?php
/**
 * Plugin Name:       Chat Pilot
 * Plugin URI:        https://localmarketinggeeks.com/chat-pilot
 * Description:       AI chatbot for WordPress, powered by the Chat Pilot Cloud platform.
 * Version:           2.3.4
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            Local Marketing Geeks
 * Author URI:        https://localmarketinggeeks.com/
 * License:           Proprietary
 * Text Domain:       chat-pilot
 *
 * ---------------------------------------------------------------------------
 * ARCHITECTURE (v2.0.0)
 * ---------------------------------------------------------------------------
 * Chat Pilot is now a two-part product:
 *
 *   Chat Pilot Cloud  - the SaaS control plane. Owns AI provider credentials,
 *                       model selection, the knowledge base, AI instructions,
 *                       the response engine, conversations, leads, analytics
 *                       and usage. It is the single source of truth.
 *
 *   This plugin       - the site-side connector. Owns the visitor-facing widget
 *                       and the WordPress integration. It holds exactly one
 *                       secret: the Chat Pilot Site API Key for this website.
 *
 * The plugin never stores an AI provider key, never talks to OpenAI or Gemini,
 * and never runs retrieval or generation locally. Every request it makes to
 * Chat Pilot Cloud is HMAC-signed with the Site API Key (see Api\Client).
 * ---------------------------------------------------------------------------
 */

// Prevent direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'CHAT_PILOT_VERSION', '2.3.4' );
define( 'CHAT_PILOT_API_VERSION', 'v1' );
define( 'CHAT_PILOT_PATH', plugin_dir_path( __FILE__ ) );
define( 'CHAT_PILOT_URL', plugin_dir_url( __FILE__ ) );
define( 'CHAT_PILOT_BASENAME', plugin_basename( __FILE__ ) );

/**
 * Chat Pilot Cloud endpoint.
 *
 * Normally an administrator sets this on the Connection tab. Defining it in
 * wp-config.php instead pins it at server level, and the admin screen then
 * shows it read-only - so nobody who only has wp-admin access can point this
 * site's signed traffic at another host:
 *
 *   define( 'CHAT_PILOT_API_URL', 'https://chatpilot.example.com' );
 */
define( 'CHAT_PILOT_API_URL_PINNED', defined( 'CHAT_PILOT_API_URL' ) );

if ( ! defined( 'CHAT_PILOT_API_URL' ) ) {
	define( 'CHAT_PILOT_API_URL', 'https://appchatpilot.vercel.app' );
}

require_once CHAT_PILOT_PATH . 'includes/Autoloader.php';
\ChatPilot\Autoloader::register();

register_activation_hook( __FILE__, array( '\ChatPilot\Core\Lifecycle', 'activate' ) );
register_deactivation_hook( __FILE__, array( '\ChatPilot\Core\Lifecycle', 'deactivate' ) );

add_action(
	'plugins_loaded',
	function () {
		\ChatPilot\Core\Plugin::instance();
	}
);
